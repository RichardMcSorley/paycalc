'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  evaluateOffer,
  DEFAULT_SETTINGS,
  type CalculationSettings
} from '@/lib/calculations';

function formatTime(mins: number, short = false): string {
  if (mins < 60) return short ? `${Math.round(mins)}m` : `${Math.round(mins)} min`;
  const hours = Math.floor(mins / 60);
  const remaining = Math.round(mins % 60);
  if (remaining === 0) return short ? `${hours}h` : `${hours} hr`;
  return short ? `${hours}h ${remaining}m` : `${hours} hr ${remaining} min`;
}

export default function Home() {
  // Offer inputs
  const [pay, setPay] = useState<string>('');
  const [pickups, setPickups] = useState<string>('1');
  const [drops, setDrops] = useState<string>('1');
  const [miles, setMiles] = useState<string>('');
  const [items, setItems] = useState<string>('0');

  // Settings
  const [settings, setSettings] = useState<CalculationSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  // What-if calculator (extra wait defaults to setting, baseline is perPickup * pickups)
  const [waitTime, setWaitTime] = useState<number | null>(null);
  const pickupsNum = parseInt(pickups) || 1;
  const baselineWaitTime = settings.perPickup * pickupsNum;
  const actualWaitTime = waitTime ?? settings.extraWaitTime;
  const extraMins = actualWaitTime - baselineWaitTime;

  // Image input
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [showLightbox, setShowLightbox] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // Share functionality
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const processImage = useCallback(async (imageFile: File) => {
    setIsProcessing(true);
    try {
      // Convert to base64 data URI
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(imageFile);
      });

      // Store the image for preview
      setUploadedImage(base64);

      const response = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      });

      const data = await response.json();

      if (data.parsed) {
        // Update form fields with parsed data
        if (data.parsed.pay !== undefined) {
          setPay(String(data.parsed.pay));
        }
        if (data.parsed.pickups !== undefined) {
          setPickups(String(data.parsed.pickups));
        }
        if (data.parsed.drops !== undefined) {
          setDrops(String(data.parsed.drops));
        }
        if (data.parsed.miles !== undefined) {
          setMiles(String(data.parsed.miles));
        }
        if (data.parsed.items !== undefined) {
          setItems(String(data.parsed.items));
        }
      }
    } catch (error) {
      console.error('Image processing error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleImageInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImage(file);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  }, [processImage]);

  // Load settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('paycalc-settings');
    if (saved) {
      try {
        // Merge with defaults to handle new settings fields
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch {
        // ignore
      }
    }
  }, []);

  // Load values from URL parameters (for sharing/external API calls)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const urlPay = params.get('pay');
    const urlPickups = params.get('pickups');
    const urlDrops = params.get('drops');
    const urlMiles = params.get('miles');
    const urlItems = params.get('items');

    if (urlPay) setPay(urlPay);
    if (urlPickups) setPickups(urlPickups);
    if (urlDrops) setDrops(urlDrops);
    if (urlMiles) setMiles(urlMiles);
    if (urlItems) setItems(urlItems);

    // Clean URL after loading params (optional - keeps URL clean)
    if (params.toString()) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Save settings to localStorage
  const updateSettings = (newSettings: CalculationSettings) => {
    setSettings(newSettings);
    localStorage.setItem('paycalc-settings', JSON.stringify(newSettings));
  };

  // Calculations using shared evaluateOffer function
  const results = useMemo(() => {
    const payNum = parseFloat(pay) || 0;
    const pickupsNum = parseInt(pickups) || 1;
    const dropsNum = parseInt(drops) || 1;
    const milesNum = parseFloat(miles) || 0;
    const itemsNum = parseInt(items) || 0;

    if (payNum <= 0 || dropsNum <= 0) {
      return null;
    }

    const evaluation = evaluateOffer(
      { pay: payNum, pickups: pickupsNum, drops: dropsNum, miles: milesNum, items: itemsNum },
      settings
    );

    return {
      evaluation,
      verdict: evaluation.verdict,
      effectiveHourly: evaluation.effectiveHourly
    };
  }, [pay, pickups, drops, miles, items, settings]);

  // Share URL with parameters
  const shareUrl = useCallback(async () => {
    const params = new URLSearchParams();
    if (pay) params.set('pay', pay);
    if (pickups !== '1') params.set('pickups', pickups);
    if (drops !== '1') params.set('drops', drops);
    if (miles) params.set('miles', miles);
    if (items !== '0') params.set('items', items);

    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'PayCalc Offer',
          text: results ? `${results.verdict.toUpperCase()}: $${pay} for ${miles}mi - $${results.effectiveHourly}/hr` : `PayCalc: $${pay}`,
          url: url
        });
        setShareStatus('Shared!');
      } else {
        await navigator.clipboard.writeText(url);
        setShareStatus('URL copied!');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        await navigator.clipboard.writeText(url);
        setShareStatus('URL copied!');
      }
    }
    setTimeout(() => setShareStatus(null), 2000);
  }, [pay, pickups, drops, miles, items, results]);

  // Generate and share image using canvas drawing (avoids oklab issues)
  const shareImage = useCallback(async () => {
    if (!results) return;

    setIsGeneratingImage(true);
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setShareStatus('Failed to generate image');
        setIsGeneratingImage(false);
        return;
      }

      // Card dimensions
      const width = 400;
      const height = 280;
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      ctx.scale(scale, scale);

      // Colors based on verdict
      const colors = {
        good: { bg: '#064e3b', border: '#10b981', text: '#34d399', subtext: '#6ee7b7' },
        decent: { bg: '#713f12', border: '#eab308', text: '#facc15', subtext: '#fde047' },
        bad: { bg: '#7f1d1d', border: '#ef4444', text: '#f87171', subtext: '#fca5a5' }
      };
      const c = colors[results.verdict];

      // Background
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, c.bg);
      gradient.addColorStop(1, '#0d0e12');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(0, 0, width, height, 16);
      ctx.fill();

      // Border
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(0, 0, width, height, 16);
      ctx.stroke();

      // Verdict text
      ctx.fillStyle = c.text;
      ctx.font = 'bold 48px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(results.verdict.toUpperCase(), width / 2, 80);

      // Hourly rate
      ctx.fillStyle = c.subtext;
      ctx.font = 'bold 32px ui-monospace, monospace';
      ctx.fillText(`$${results.effectiveHourly}/hr`, width / 2, 125);

      // Divider
      ctx.strokeStyle = '#1e2028';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, 150);
      ctx.lineTo(width - 20, 150);
      ctx.stroke();

      // Offer details
      ctx.fillStyle = '#9ca3af';
      ctx.font = '14px system-ui, -apple-system, sans-serif';
      ctx.fillText('Offer Details', width / 2, 175);

      ctx.fillStyle = '#e8e9eb';
      ctx.font = '18px ui-monospace, monospace';
      const payNum = parseFloat(pay) || 0;
      const milesNum = parseFloat(miles) || 0;
      ctx.fillText(`$${payNum.toFixed(2)} · ${milesNum.toFixed(1)} mi`, width / 2, 200);

      ctx.fillStyle = '#6b7280';
      ctx.font = '14px ui-monospace, monospace';
      ctx.fillText(`${pickups} pickup · ${drops} drop${parseInt(drops) > 1 ? 's' : ''}`, width / 2, 225);

      // Branding
      ctx.fillStyle = '#4a4d58';
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      ctx.fillText('PayCalc', width / 2, 260);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          setShareStatus('Failed to generate image');
          setIsGeneratingImage(false);
          return;
        }

        const file = new File([blob], 'paycalc-verdict.png', { type: 'image/png' });

        try {
          if (navigator.share && navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: 'PayCalc Verdict',
              text: `${results.verdict.toUpperCase()}: $${pay} - $${results.effectiveHourly}/hr`
            });
            setShareStatus('Shared!');
          } else {
            // Fallback: download the image
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'paycalc-verdict.png';
            a.click();
            URL.revokeObjectURL(url);
            setShareStatus('Image saved!');
          }
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            // Fallback: download the image
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'paycalc-verdict.png';
            a.click();
            URL.revokeObjectURL(url);
            setShareStatus('Image saved!');
          }
        }
        setIsGeneratingImage(false);
        setTimeout(() => setShareStatus(null), 2000);
      }, 'image/png');
    } catch (err) {
      console.error('Image generation error:', err);
      setShareStatus('Failed to generate image');
      setIsGeneratingImage(false);
      setTimeout(() => setShareStatus(null), 2000);
    }
  }, [pay, miles, pickups, drops, results]);

  const hasOffer = parseFloat(pay) > 0;
  const hasRoute = parseFloat(miles) > 0;

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-[#e8e9eb] selection:bg-emerald-500/30 noise-overlay">
      {/* Header */}
      <header className="border-b border-[#1e2028] bg-[#0d0e12]">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
              <span className="text-sm font-bold text-black">$</span>
            </div>
            <h1 className="text-lg font-semibold tracking-tight">PayCalc</h1>
          </div>
          <div className="flex items-center gap-1">
          {/* Hidden file input for image/screenshot upload */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageInput}
            className="hidden"
          />
          {/* Camera/Screenshot button */}
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={isProcessing}
            className={`p-2 rounded-lg transition-colors ${
              isProcessing
                ? 'bg-[#1e2028] text-emerald-400'
                : 'text-[#6b7280] hover:text-[#e8e9eb] hover:bg-[#1e2028]'
            }`}
          >
            {isProcessing ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-lg transition-colors ${
              showSettings
                ? 'bg-[#1e2028] text-emerald-400'
                : 'text-[#6b7280] hover:text-[#e8e9eb] hover:bg-[#1e2028]'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Settings Panel */}
        {showSettings && (
          <section className="bg-[#12141a] rounded-2xl border border-[#1e2028] p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-[#9ca3af]">Settings</h2>
              <button
                onClick={() => {
                  updateSettings(DEFAULT_SETTINGS);
                }}
                className="text-xs text-[#6b7280] hover:text-emerald-400 transition-colors"
              >
                Reset defaults
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SettingInput
                label="Target $/hr"
                value={settings.expectedPay}
                onChange={(v) => updateSettings({ ...settings, expectedPay: v })}
                prefix="$"
              />
              <SettingInput
                label="Min $/hr"
                value={settings.minHourlyPay}
                onChange={(v) => updateSettings({ ...settings, minHourlyPay: v })}
                prefix="$"
              />
              <SettingInput
                label="Max Orders/hr"
                value={settings.maxOrdersPerHour}
                onChange={(v) => updateSettings({ ...settings, maxOrdersPerHour: v })}
              />
              <SettingInput
                label="Avg Speed"
                value={settings.avgSpeed}
                onChange={(v) => updateSettings({ ...settings, avgSpeed: v })}
                suffix="mph"
              />
              <SettingInput
                label="Per Pickup"
                value={settings.perPickup}
                onChange={(v) => updateSettings({ ...settings, perPickup: v })}
                suffix="min"
              />
              <SettingInput
                label="Per Drop"
                value={settings.perDrop}
                onChange={(v) => updateSettings({ ...settings, perDrop: v })}
                suffix="min"
              />
              <SettingInput
                label="Per Item"
                value={settings.perItem}
                onChange={(v) => updateSettings({ ...settings, perItem: v })}
                suffix="min"
                step={0.5}
              />
              <SettingInput
                label="Extra Wait"
                value={settings.extraWaitTime}
                onChange={(v) => updateSettings({ ...settings, extraWaitTime: v })}
                suffix="min"
              />
              <SliderInput
                label="Return 1 Drop"
                hint="% of trip miles added for driving back after single-drop orders"
                value={settings.return1Drop}
                onChange={(v) => updateSettings({ ...settings, return1Drop: v })}
              />
              <SliderInput
                label="Return 2+ Drops"
                hint="% of trip miles added for return on multi-drop orders"
                value={settings.return2Drop}
                onChange={(v) => updateSettings({ ...settings, return2Drop: v })}
              />
            </div>
          </section>
        )}

        {/* Offer Input */}
        <section className="bg-[#12141a] rounded-2xl border border-[#1e2028] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-[#9ca3af]">Offer Details</h2>
            {uploadedImage && (
              <button
                onClick={() => setShowLightbox(true)}
                className="group relative flex items-center gap-2 px-2 py-1 -mr-1 rounded-lg hover:bg-[#1e2028] transition-all duration-200"
              >
                <span className="text-xs text-[#6b7280] group-hover:text-emerald-400 transition-colors">Source</span>
                <div className="relative w-8 h-8 rounded-md overflow-hidden border border-[#2a2d38] group-hover:border-emerald-500/50 transition-all duration-200 group-hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                  <img
                    src={uploadedImage}
                    alt="Uploaded screenshot"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            )}
          </div>

          {/* Pay - Prominent */}
          <div className="flex items-center bg-[#0a0b0d] border border-[#2a2d38] rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => {
                const current = parseFloat(pay) || 0;
                const newVal = Math.max(0, current - 0.25);
                setPay(newVal.toFixed(2));
              }}
              className="px-5 py-4 text-[#6b7280] hover:text-emerald-400 hover:bg-[#1e2028] transition-all btn-press"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <div className="flex-1 relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-2xl text-[#6b7280] font-mono">$</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={pay}
                onChange={(e) => setPay(e.target.value)}
                className="w-full bg-transparent pl-8 pr-2 py-4 text-3xl font-mono text-center placeholder:text-[#3a3d48] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                const current = parseFloat(pay) || 0;
                const newVal = current + 0.25;
                setPay(newVal.toFixed(2));
              }}
              className="px-5 py-4 text-[#6b7280] hover:text-emerald-400 hover:bg-[#1e2028] transition-all btn-press"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Pickups & Drops */}
          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label="Pickups"
              value={pickups}
              onChange={setPickups}
              min={1}
              max={999}
            />
            <NumberInput
              label="Drops"
              value={drops}
              onChange={setDrops}
              min={1}
              max={999}
            />
          </div>

          {/* Miles & Items */}
          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label="Miles"
              value={miles}
              onChange={setMiles}
              min={0}
              max={999}
              step={0.5}
              decimals
            />
            <NumberInput
              label="Items (shop)"
              value={items}
              onChange={setItems}
              min={0}
              max={999}
            />
          </div>
        </section>

        {/* Combined Verdict & Thresholds Card */}
        {hasOffer && results && (
          <section
            className={`rounded-2xl border-2 overflow-hidden transition-all duration-300 animate-scale-in relative ${
              hasRoute
                ? results.verdict === 'good'
                  ? 'bg-gradient-to-b from-emerald-950/50 to-[#0d0e12] border-emerald-500/50 verdict-glow-good'
                  : results.verdict === 'decent'
                    ? 'bg-gradient-to-b from-yellow-950/50 to-[#0d0e12] border-yellow-500/50 verdict-glow-decent'
                    : 'bg-gradient-to-b from-red-950/50 to-[#0d0e12] border-red-500/50 verdict-glow-bad'
                : 'bg-[#12141a] border-[#2a2d38]'
            }`}
          >
            {/* Share button */}
            <button
              onClick={() => setShowShareModal(true)}
              className="absolute top-3 right-3 p-2 rounded-lg text-[#6b7280] hover:text-[#e8e9eb] hover:bg-white/5 transition-all btn-press z-10"
              title="Share"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
            {/* Verdict Header */}
            <div className="p-6 text-center relative">
              {/* Decorative corner accents */}
              {hasRoute && (
                <>
                  <div className={`absolute top-0 left-0 w-20 h-20 opacity-20 ${
                    results.verdict === 'good' ? 'bg-gradient-to-br from-emerald-400' :
                    results.verdict === 'decent' ? 'bg-gradient-to-br from-yellow-400' :
                    'bg-gradient-to-br from-red-400'
                  } to-transparent`} />
                  <div className={`absolute bottom-0 right-0 w-20 h-20 opacity-20 ${
                    results.verdict === 'good' ? 'bg-gradient-to-tl from-emerald-400' :
                    results.verdict === 'decent' ? 'bg-gradient-to-tl from-yellow-400' :
                    'bg-gradient-to-tl from-red-400'
                  } to-transparent`} />
                </>
              )}
              {hasRoute ? (
                <>
                  <div className={`text-6xl font-black tracking-tighter mb-2 ${
                    results.verdict === 'good'
                      ? 'verdict-text-good'
                      : results.verdict === 'decent'
                        ? 'verdict-text-decent'
                        : 'verdict-text-bad'
                  }`}>
                    {results.verdict === 'good' ? 'GOOD' : results.verdict === 'decent' ? 'DECENT' : 'BAD'}
                  </div>
                  <div className={`text-3xl font-bold font-mono tracking-tight ${
                    results.verdict === 'good'
                      ? 'text-emerald-300/90'
                      : results.verdict === 'decent'
                        ? 'text-yellow-300/90'
                        : 'text-red-300/90'
                  }`}>
                    ${results.effectiveHourly}<span className="text-lg opacity-70">/hr</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-[#e8e9eb] mb-1">
                    Max {results.evaluation.maxMiles.toFixed(1)} mi
                  </div>
                  <div className="text-sm text-[#6b7280]">
                    for ${pay} at {formatTime(results.evaluation.maxMinutes)} budget
                  </div>
                </>
              )}
            </div>

            {/* Thresholds Section - integrated below verdict */}
            {hasRoute && (
              <div className="bg-[#0a0b0d]/60 border-t border-[#1e2028]/50 px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#6b7280] uppercase tracking-wider">
                    {results.verdict === 'good' ? 'Buffer to BAD' : 'Need for GOOD'}
                  </span>
                </div>
                <div className={`grid ${parseInt(items) > 0 ? 'grid-cols-4' : 'grid-cols-3'} gap-3`}>
                  {/* Miles */}
                  {(() => {
                    const currentMiles = parseFloat(miles) || 0;
                    const isGood = results.verdict === 'good';
                    const targetMiles = isGood
                      ? (results.evaluation.thresholds.maxMilesBeforeBad ?? 0)
                      : (results.evaluation.thresholds.maxMilesForGood || 0);
                    const delta = isGood ? (targetMiles - currentMiles) : (currentMiles - targetMiles);
                    const canBeGood = results.evaluation.thresholds.canBeGood;
                    const showData = isGood || canBeGood;
                    return (
                      <div className="text-center">
                        <div className="text-[10px] text-[#6b7280] mb-0.5">Miles</div>
                        <div className="text-sm font-mono text-[#e8e9eb]">{currentMiles.toFixed(1)}</div>
                        <div className={`text-xs font-mono font-semibold ${
                          isGood ? 'text-emerald-400' : (showData ? 'text-red-400' : 'text-[#3a3d48]')
                        }`}>
                          {showData ? (isGood ? `+${delta.toFixed(1)}` : `−${delta.toFixed(1)}`) : '—'}
                        </div>
                        <div className={`text-xs font-mono mt-0.5 pt-0.5 border-t border-[#2a2d38]/50 ${
                          isGood ? 'text-red-400/70' : (showData ? 'text-emerald-400/70' : 'text-[#3a3d48]')
                        }`}>
                          {showData ? targetMiles.toFixed(1) : 'N/A'}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Time */}
                  {(() => {
                    const currentTime = results.evaluation.totalMinutes;
                    const isGood = results.verdict === 'good';
                    const targetTime = isGood
                      ? (results.evaluation.thresholds.maxTimeBeforeBad ?? 0)
                      : (results.evaluation.thresholds.maxTimeForGood || 0);
                    const delta = isGood ? (targetTime - currentTime) : (currentTime - targetTime);
                    const canBeGood = results.evaluation.thresholds.canBeGood;
                    const showData = isGood || canBeGood;
                    return (
                      <div className="text-center">
                        <div className="text-[10px] text-[#6b7280] mb-0.5">Time</div>
                        <div className="text-sm font-mono text-[#e8e9eb]">{formatTime(currentTime, true)}</div>
                        <div className={`text-xs font-mono font-semibold ${
                          isGood ? 'text-emerald-400' : (showData ? 'text-red-400' : 'text-[#3a3d48]')
                        }`}>
                          {showData ? (isGood ? `+${formatTime(delta, true)}` : `−${formatTime(delta, true)}`) : '—'}
                        </div>
                        <div className={`text-xs font-mono mt-0.5 pt-0.5 border-t border-[#2a2d38]/50 ${
                          isGood ? 'text-red-400/70' : (showData ? 'text-emerald-400/70' : 'text-[#3a3d48]')
                        }`}>
                          {showData ? formatTime(targetTime, true) : 'N/A'}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Items - only show if there are items */}
                  {parseInt(items) > 0 && (() => {
                    const currentItems = parseInt(items) || 0;
                    const isGood = results.verdict === 'good';
                    const targetItems = isGood
                      ? (results.evaluation.thresholds.maxItemsBeforeBad ?? 0)
                      : (results.evaluation.thresholds.maxItemsForGood || 0);
                    const delta = isGood ? (targetItems - currentItems) : (currentItems - targetItems);
                    const canBeGood = results.evaluation.thresholds.canBeGood;
                    const showData = isGood || canBeGood;
                    return (
                      <div className="text-center">
                        <div className="text-[10px] text-[#6b7280] mb-0.5">Items</div>
                        <div className="text-sm font-mono text-[#e8e9eb]">{currentItems}</div>
                        <div className={`text-xs font-mono font-semibold ${
                          isGood ? 'text-emerald-400' : (showData ? 'text-red-400' : 'text-[#3a3d48]')
                        }`}>
                          {showData ? (isGood ? `+${delta}` : `−${delta}`) : '—'}
                        </div>
                        <div className={`text-xs font-mono mt-0.5 pt-0.5 border-t border-[#2a2d38]/50 ${
                          isGood ? 'text-red-400/70' : (showData ? 'text-emerald-400/70' : 'text-[#3a3d48]')
                        }`}>
                          {showData ? targetItems : 'N/A'}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Pay */}
                  {(() => {
                    const currentPay = parseFloat(pay) || 0;
                    const isGood = results.verdict === 'good';
                    const targetPay = isGood
                      ? results.evaluation.thresholds.minPayBeforeBad
                      : results.evaluation.thresholds.minPayForGood;
                    const delta = isGood ? (currentPay - targetPay) : (targetPay - currentPay);
                    return (
                      <div className="text-center">
                        <div className="text-[10px] text-[#6b7280] mb-0.5">Pay</div>
                        <div className="text-sm font-mono text-[#e8e9eb]">${currentPay.toFixed(2)}</div>
                        <div className={`text-xs font-mono font-semibold ${
                          isGood ? 'text-emerald-400' : 'text-emerald-400'
                        }`}>
                          {isGood ? `−$${delta.toFixed(2)}` : `+$${delta.toFixed(2)}`}
                        </div>
                        <div className={`text-xs font-mono mt-0.5 pt-0.5 border-t border-[#2a2d38]/50 ${
                          isGood ? 'text-red-400/70' : 'text-emerald-400/70'
                        }`}>
                          ${targetPay.toFixed(2)}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </section>
        )}

        {/* What-If Delay Calculator */}
        {hasOffer && results && hasRoute && (
          <section className="card-hypothetical rounded-2xl p-4 space-y-3 overflow-hidden">
            <div className="flex items-center justify-between relative">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full border border-dashed border-emerald-500/40 flex items-center justify-center">
                  <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-medium text-[#9ca3af]">Extra Wait Time</h2>
                  <p className="text-[10px] text-[#4a4d58]">Simulate delays at pickup to see impact on pay</p>
                </div>
              </div>
              <button
                onClick={() => setWaitTime(null)}
                className="text-xs text-[#6b7280] hover:text-emerald-400 transition-colors btn-press"
              >
                Reset
              </button>
            </div>

            {/* Wait time input */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setWaitTime(Math.max(0, actualWaitTime - 1))}
                className="px-3 py-1.5 text-[#6b7280] hover:text-emerald-400 hover:bg-[#1e2028] rounded-lg transition-all btn-press"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              <div className="flex-1 text-center">
                <span className="text-2xl font-mono text-[#e8e9eb]">{actualWaitTime}</span>
                <span className="text-sm text-[#6b7280] ml-1">min</span>
                {extraMins !== 0 && (
                  <span className={`text-sm font-mono ml-2 ${extraMins > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    ({extraMins > 0 ? '+' : ''}{extraMins})
                  </span>
                )}
              </div>
              <button
                onClick={() => setWaitTime(actualWaitTime + 1)}
                className="px-3 py-1.5 text-[#6b7280] hover:text-emerald-400 hover:bg-[#1e2028] rounded-lg transition-all btn-press"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            {/* Quick add buttons */}
            <div className="flex gap-2 justify-center">
              {[5, 10, 15, 30].map((mins) => (
                <button
                  key={mins}
                  onClick={() => setWaitTime(actualWaitTime + mins)}
                  className="px-3 py-1.5 text-xs font-mono text-[#6b7280] hover:text-emerald-400 hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/30 rounded-lg transition-all btn-press"
                >
                  +{mins}
                </button>
              ))}
            </div>

            {/* Impact calculation */}
            {(() => {
              const currentPay = parseFloat(pay) || 0;
              const newTotalMins = results.evaluation.totalMinutes + extraMins;
              const newOrdersPerHour = Math.min(settings.maxOrdersPerHour, 60 / newTotalMins);
              const newEffectiveHourly = Math.round(currentPay * newOrdersPerHour * 100) / 100;

              // What pay needed for GOOD with new time?
              const payForGood = Math.round((settings.expectedPay / newOrdersPerHour) * 100) / 100;
              const payDelta = payForGood - currentPay;

              // New verdict
              const meetsFloor = settings.minHourlyPay > 0
                ? newEffectiveHourly >= settings.minHourlyPay
                : currentPay >= (newTotalMins * settings.expectedPay / 60);
              const newVerdict = !meetsFloor ? 'BAD' : newEffectiveHourly >= settings.expectedPay ? 'GOOD' : 'DECENT';
              const verdictColor = newVerdict === 'GOOD' ? 'text-emerald-400' : newVerdict === 'DECENT' ? 'text-yellow-400' : 'text-red-400';

              return (
                <div className="pt-3 border-t border-[#1e2028] space-y-2">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-xs text-[#6b7280]">Total Time</div>
                      <div className="text-lg font-mono text-[#e8e9eb]">
                        {formatTime(newTotalMins, true)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[#6b7280]">$/hr</div>
                      <div className={`text-lg font-mono ${verdictColor}`}>
                        ${newEffectiveHourly}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[#6b7280]">Verdict</div>
                      <div className={`text-lg font-bold ${verdictColor}`}>
                        {newVerdict}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#1e2028]">
                    <span className="text-sm text-[#6b7280]">Pay needed for GOOD</span>
                    <div className="text-right">
                      <span className="text-lg font-mono font-bold text-emerald-400">
                        ${payForGood.toFixed(2)}
                      </span>
                      {payDelta > 0 && (
                        <span className="text-sm font-mono text-emerald-400 ml-2">(+${payDelta.toFixed(2)})</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {/* Breakdown */}
        {hasOffer && results && hasRoute && (
          <section className="bg-[#12141a] rounded-2xl border border-[#1e2028] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-[#9ca3af]">Time Breakdown</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#6b7280]">Total</span>
                <span className="text-base font-mono font-semibold text-[#e8e9eb] bg-[#0a0b0d] px-2 py-0.5 rounded-lg border border-[#2a2d38]">
                  {formatTime(results.evaluation.totalMinutes)}
                </span>
              </div>
            </div>

            {/* Stacked bar with glow */}
            <div className="relative">
              <div className="h-5 bg-[#0a0b0d] rounded-full overflow-hidden flex border border-[#1e2028] shadow-inner">
                {[
                  { value: results.evaluation.breakdown.pickup, color: 'bg-blue-500', glow: 'shadow-blue-500/30' },
                  { value: results.evaluation.breakdown.travel, color: 'bg-purple-500', glow: 'shadow-purple-500/30' },
                  { value: results.evaluation.breakdown.drop, color: 'bg-cyan-500', glow: 'shadow-cyan-500/30' },
                  { value: results.evaluation.breakdown.shopping, color: 'bg-amber-500', glow: 'shadow-amber-500/30' },
                  { value: results.evaluation.breakdown.return, color: 'bg-rose-500', glow: 'shadow-rose-500/30' },
                ].map((segment, i) => {
                  const percent = results.evaluation.totalMinutes > 0
                    ? (segment.value / results.evaluation.totalMinutes) * 100
                    : 0;
                  if (percent === 0) return null;
                  return (
                    <div
                      key={i}
                      className={`${segment.color} time-segment transition-all duration-500`}
                      style={{ width: `${percent}%` }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Enhanced Legend - Grid layout with percentages */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Pickup', value: results.evaluation.breakdown.pickup, color: 'bg-blue-500', textColor: 'text-blue-400' },
                { label: 'Travel', value: results.evaluation.breakdown.travel, color: 'bg-purple-500', textColor: 'text-purple-400' },
                { label: 'Drop-off', value: results.evaluation.breakdown.drop, color: 'bg-cyan-500', textColor: 'text-cyan-400' },
                { label: 'Shopping', value: results.evaluation.breakdown.shopping, color: 'bg-amber-500', textColor: 'text-amber-400' },
                { label: 'Return', value: results.evaluation.breakdown.return, color: 'bg-rose-500', textColor: 'text-rose-400' },
              ].filter(s => s.value > 0).map((segment, i) => {
                const percent = results.evaluation.totalMinutes > 0
                  ? Math.round((segment.value / results.evaluation.totalMinutes) * 100)
                  : 0;
                return (
                  <div key={i} className="flex items-center justify-between bg-[#0a0b0d]/50 rounded-lg px-3 py-2 border border-[#1e2028]/50">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${segment.color} shadow-sm`} />
                      <span className="text-xs text-[#9ca3af]">{segment.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono font-semibold ${segment.textColor}`}>
                        {formatTime(segment.value, true)}
                      </span>
                      <span className="text-[10px] font-mono text-[#4a4d58] w-8 text-right">
                        {percent}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

      </main>

      {/* Image Lightbox */}
      {showLightbox && uploadedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setShowLightbox(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          {/* Image Container */}
          <div
            className="relative max-w-2xl max-h-[85vh] w-full animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setShowLightbox(false)}
              className="absolute -top-12 right-0 p-2 text-[#6b7280] hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Image */}
            <div className="relative rounded-2xl overflow-hidden border border-[#2a2d38] shadow-2xl shadow-black/50">
              <img
                src={uploadedImage}
                alt="Uploaded screenshot"
                className="w-full h-auto max-h-[85vh] object-contain bg-[#0a0b0d]"
              />
              {/* Subtle corner accent */}
              <div className="absolute top-0 left-0 w-16 h-16 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
              <div className="absolute bottom-0 right-0 w-16 h-16 bg-gradient-to-tl from-emerald-500/10 to-transparent pointer-events-none" />
            </div>

            {/* Label */}
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-xs text-[#6b7280]">
              Tap outside to close
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setShowShareModal(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          {/* Modal */}
          <div
            className="relative bg-[#12141a] rounded-2xl border border-[#2a2d38] p-6 w-full max-w-sm animate-in zoom-in-95 duration-200 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-[#e8e9eb]">Share</h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="p-1 text-[#6b7280] hover:text-[#e8e9eb] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Status message */}
            {shareStatus && (
              <div className="mb-4 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-center">
                <span className="text-sm text-emerald-400">{shareStatus}</span>
              </div>
            )}

            {/* Share options */}
            <div className="space-y-3">
              <button
                onClick={() => {
                  shareUrl();
                  setShowShareModal(false);
                }}
                className="w-full flex items-center gap-4 p-4 bg-[#0a0b0d] border border-[#2a2d38] rounded-xl hover:border-emerald-500/50 hover:bg-[#1e2028] transition-all btn-press group"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-[#e8e9eb]">Share Link</div>
                  <div className="text-xs text-[#6b7280]">Copy URL with offer details</div>
                </div>
              </button>

              <button
                onClick={() => {
                  shareImage();
                  setShowShareModal(false);
                }}
                disabled={isGeneratingImage}
                className="w-full flex items-center gap-4 p-4 bg-[#0a0b0d] border border-[#2a2d38] rounded-xl hover:border-emerald-500/50 hover:bg-[#1e2028] transition-all btn-press group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                  {isGeneratingImage ? (
                    <svg className="w-5 h-5 text-purple-400 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-[#e8e9eb]">Share Image</div>
                  <div className="text-xs text-[#6b7280]">Generate verdict card image</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Stepper input for pickups/drops
function NumberInput({
  label,
  value,
  onChange,
  min = 1,
  max = 99,
  step = 1,
  decimals = false
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: boolean;
}) {
  const numValue = decimals ? (parseFloat(value) || min) : (parseInt(value) || min);

  const decrement = () => {
    const newVal = Math.max(min, numValue - step);
    onChange(decimals ? newVal.toFixed(1) : String(Math.round(newVal)));
  };

  const increment = () => {
    const newVal = Math.min(max, numValue + step);
    onChange(decimals ? newVal.toFixed(1) : String(Math.round(newVal)));
  };

  return (
    <div>
      <label className="block text-xs text-[#6b7280] mb-1.5 ml-1">{label}</label>
      <div className="flex items-center bg-[#0a0b0d] border border-[#2a2d38] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={decrement}
          className="flex-shrink-0 px-4 py-3 text-[#6b7280] hover:text-emerald-400 hover:bg-[#1e2028] transition-all btn-press"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <input
          type="number"
          inputMode={decimals ? "decimal" : "numeric"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-center text-lg font-mono py-3 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={increment}
          className="flex-shrink-0 px-4 py-3 text-[#6b7280] hover:text-emerald-400 hover:bg-[#1e2028] transition-all btn-press"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Setting input with prefix/suffix
function SettingInput({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-xs text-[#6b7280] mb-1.5 ml-1">{label}</label>
      <div className="flex items-center bg-[#0a0b0d] border border-[#2a2d38] rounded-lg overflow-hidden">
        {prefix && (
          <span className="flex-shrink-0 pl-3 text-sm text-[#6b7280]">{prefix}</span>
        )}
        <input
          type="number"
          inputMode="decimal"
          value={value}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-mono focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && (
          <span className="flex-shrink-0 pr-3 text-sm text-[#6b7280]">{suffix}</span>
        )}
      </div>
    </div>
  );
}

// Slider input for percentage values
function SliderInput({
  label,
  value,
  onChange,
  hint,
  min = 0,
  max = 100,
  step = 5
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const progress = ((value - min) / (max - min)) * 100;

  return (
    <div className="col-span-2 py-1">
      <div className="flex items-center justify-between mb-1">
        <div>
          <label className="text-xs text-[#6b7280] ml-1">{label}</label>
          {hint && (
            <p className="text-[10px] text-[#4a4d58] ml-1 mt-0.5">{hint}</p>
          )}
        </div>
        <div className="flex items-center gap-1 bg-[#0a0b0d] border border-[#2a2d38] rounded-lg px-3 py-1">
          <span className="text-sm font-mono text-emerald-400 font-semibold tabular-nums">
            {value}
          </span>
          <span className="text-xs text-[#6b7280]">%</span>
        </div>
      </div>
      <div className="relative px-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="slider-return w-full"
          style={{ '--slider-progress': `${progress}%` } as React.CSSProperties}
        />
        <div className="flex justify-between mt-1 px-0.5">
          <span className="text-[10px] text-[#3a3d48] font-mono">{min}%</span>
          <span className="text-[10px] text-[#3a3d48] font-mono">{max}%</span>
        </div>
      </div>
    </div>
  );
}

// Time breakdown bar
function TimeBar({
  label,
  value,
  total,
  color
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percent = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#6b7280] w-16">{label}</span>
      <div className="flex-1 h-2 bg-[#1e2028] rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs font-mono text-[#9ca3af] w-12 text-right">
        {value.toFixed(1)}m
      </span>
    </div>
  );
}
