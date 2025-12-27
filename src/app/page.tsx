'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  calculateMaxes,
  calculatePayReq,
  DEFAULT_SETTINGS,
  type CalculationSettings
} from '@/lib/calculations';

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

  // Voice input
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const processVoice = useCallback(async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      // Convert blob to base64 data URI
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(audioBlob);
      });

      const response = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64 }),
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
      console.error('Voice processing error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Try to use a format supported by FAL (mp4/aac, ogg, or wav)
      // Safari supports mp4, Chrome/Firefox support ogg/webm
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      } else if (MediaRecorder.isTypeSupported('audio/wav')) {
        mimeType = 'audio/wav';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach(track => track.stop());
        processVoice(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      if (error instanceof TypeError) {
        // navigator.mediaDevices is undefined - needs HTTPS
        setVoiceError('Microphone requires HTTPS (try Chrome on localhost)');
      } else if (error instanceof Error) {
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          setVoiceError('No microphone found');
        } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          setVoiceError('Microphone permission denied');
        } else if (error.name === 'NotReadableError' || error.name === 'AbortError') {
          setVoiceError('Microphone is in use by another app');
        } else {
          setVoiceError(error.message);
        }
      }
    }
  }, [processVoice]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  // Load settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('paycalc-settings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, []);

  // Save settings to localStorage
  const updateSettings = (newSettings: CalculationSettings) => {
    setSettings(newSettings);
    localStorage.setItem('paycalc-settings', JSON.stringify(newSettings));
  };

  // Calculations
  const results = useMemo(() => {
    const payNum = parseFloat(pay) || 0;
    const pickupsNum = parseInt(pickups) || 1;
    const dropsNum = parseInt(drops) || 1;
    const milesNum = parseFloat(miles) || 0;
    const itemsNum = parseInt(items) || 0;

    if (payNum <= 0 || dropsNum <= 0) {
      return null;
    }

    const maxes = calculateMaxes(
      { pay: payNum, pickups: pickupsNum, drops: dropsNum },
      settings
    );

    const payReq = calculatePayReq(
      { pickups: pickupsNum, drops: dropsNum, miles: milesNum, items: itemsNum },
      settings
    );

    const meetsRequired = payNum >= payReq.payReq;
    const difference = payNum - payReq.payReq;
    // Cap effective hourly by max orders per hour
    const ordersPerHour = payReq.totalMins > 0
      ? Math.min(settings.maxOrdersPerHour, 60 / payReq.totalMins)
      : 0;
    const effectiveHourly = payNum * ordersPerHour;

    // GOOD: meets required AND effective hourly >= target
    // DECENT: meets required BUT effective hourly < target
    // BAD: doesn't meet required
    const verdict: 'good' | 'decent' | 'bad' = !meetsRequired
      ? 'bad'
      : effectiveHourly >= settings.expectedPay
        ? 'good'
        : 'decent';

    return {
      maxes,
      payReq,
      verdict,
      difference,
      effectiveHourly: Math.round(effectiveHourly * 100) / 100
    };
  }, [pay, pickups, drops, miles, items, settings]);

  const hasOffer = parseFloat(pay) > 0;
  const hasRoute = parseFloat(miles) > 0;

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-[#e8e9eb] selection:bg-emerald-500/30">
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
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className={`p-2 rounded-lg transition-colors ${
              isRecording
                ? 'bg-red-500/20 text-red-400 animate-pulse'
                : isProcessing
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
              <svg className="w-5 h-5" fill={isRecording ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
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

      {/* Voice error toast */}
      {voiceError && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <div className="bg-red-950/50 border border-red-500/50 text-red-400 px-4 py-2 rounded-xl text-sm flex items-center justify-between">
            <span>{voiceError}</span>
            <button onClick={() => setVoiceError(null)} className="ml-2 hover:text-red-300">×</button>
          </div>
        </div>
      )}

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
                label="Return 1 Drop"
                value={settings.return1Drop}
                onChange={(v) => updateSettings({ ...settings, return1Drop: v })}
                suffix="%"
              />
              <SettingInput
                label="Return 2 Drop"
                value={settings.return2Drop}
                onChange={(v) => updateSettings({ ...settings, return2Drop: v })}
                suffix="%"
              />
            </div>
          </section>
        )}

        {/* Offer Input */}
        <section className="bg-[#12141a] rounded-2xl border border-[#1e2028] p-4 space-y-4">
          <h2 className="text-sm font-medium text-[#9ca3af]">Offer Details</h2>

          {/* Pay - Prominent */}
          <div className="flex items-center bg-[#0a0b0d] border border-[#2a2d38] rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => {
                const current = parseFloat(pay) || 0;
                const newVal = Math.max(0, current - 0.25);
                setPay(newVal.toFixed(2));
              }}
              className="px-5 py-4 text-[#6b7280] hover:text-[#e8e9eb] hover:bg-[#1e2028] transition-colors"
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
              className="px-5 py-4 text-[#6b7280] hover:text-[#e8e9eb] hover:bg-[#1e2028] transition-colors"
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
              max={10}
            />
            <NumberInput
              label="Drops"
              value={drops}
              onChange={setDrops}
              min={1}
              max={10}
            />
          </div>

          {/* Miles & Items */}
          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label="Miles"
              value={miles}
              onChange={setMiles}
              min={0}
              max={100}
              step={0.5}
              decimals
            />
            <NumberInput
              label="Items (shop)"
              value={items}
              onChange={setItems}
              min={0}
              max={100}
            />
          </div>
        </section>

        {/* Verdict */}
        {hasOffer && results && (
          <section
            className={`rounded-2xl border-2 p-6 text-center transition-all duration-300 ${
              hasRoute
                ? results.verdict === 'good'
                  ? 'bg-emerald-950/30 border-emerald-500/50'
                  : results.verdict === 'decent'
                    ? 'bg-yellow-950/30 border-yellow-500/50'
                    : 'bg-red-950/30 border-red-500/50'
                : 'bg-[#12141a] border-[#2a2d38]'
            }`}
          >
            {hasRoute ? (
              <>
                <div className={`text-5xl font-black tracking-tight mb-2 ${
                  results.verdict === 'good'
                    ? 'text-emerald-400'
                    : results.verdict === 'decent'
                      ? 'text-yellow-400'
                      : 'text-red-400'
                }`}>
                  {results.verdict === 'good' ? 'GOOD' : results.verdict === 'decent' ? 'DECENT' : 'BAD'}
                </div>
                <div className={`text-2xl font-bold font-mono ${
                  results.verdict === 'good'
                    ? 'text-emerald-300'
                    : results.verdict === 'decent'
                      ? 'text-yellow-300'
                      : 'text-red-300'
                }`}>
                  ${results.effectiveHourly}/hr effective
                </div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-[#e8e9eb] mb-1">
                  Max {results.maxes.maxMiles.toFixed(1)} mi
                </div>
                <div className="text-sm text-[#6b7280]">
                  for ${pay} at {results.maxes.maxMins.toFixed(0)} min budget
                </div>
              </>
            )}
          </section>
        )}

        {/* Breakdown */}
        {hasOffer && results && hasRoute && (
          <section className="bg-[#12141a] rounded-2xl border border-[#1e2028] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-[#9ca3af]">Time Breakdown</h2>
              <span className="text-sm font-mono text-[#e8e9eb]">
                {results.payReq.totalMins.toFixed(1)} min total
              </span>
            </div>

            <div className="space-y-2">
              <TimeBar
                label="Pickup"
                value={results.payReq.pickupTime}
                total={results.payReq.totalMins}
                color="bg-blue-500"
              />
              <TimeBar
                label="Travel"
                value={results.payReq.travelTime}
                total={results.payReq.totalMins}
                color="bg-purple-500"
              />
              <TimeBar
                label="Drop"
                value={results.payReq.dropTime}
                total={results.payReq.totalMins}
                color="bg-cyan-500"
              />
              {results.payReq.shoppingTime > 0 && (
                <TimeBar
                  label="Shopping"
                  value={results.payReq.shoppingTime}
                  total={results.payReq.totalMins}
                  color="bg-amber-500"
                />
              )}
              <TimeBar
                label="Return"
                value={results.payReq.returnDelta}
                total={results.payReq.totalMins}
                color="bg-rose-500"
              />
            </div>

            <div className="pt-3 border-t border-[#1e2028] flex justify-between items-center">
              <span className="text-sm text-[#6b7280]">Required pay</span>
              <span className="text-lg font-mono font-bold text-[#e8e9eb]">
                ${results.payReq.payReq.toFixed(2)}
              </span>
            </div>
          </section>
        )}

        {/* Limits */}
        {hasOffer && results && (
          <section className="bg-[#12141a] rounded-2xl border border-[#1e2028] p-4">
            <h2 className="text-sm font-medium text-[#9ca3af] mb-3">Maximums for ${pay}</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold font-mono text-[#e8e9eb]">
                  {results.maxes.maxMiles.toFixed(1)}
                </div>
                <div className="text-xs text-[#6b7280]">max miles</div>
              </div>
              <div>
                <div className="text-2xl font-bold font-mono text-[#e8e9eb]">
                  {results.maxes.maxItems}
                </div>
                <div className="text-xs text-[#6b7280]">max items</div>
              </div>
              <div>
                <div className="text-2xl font-bold font-mono text-[#e8e9eb]">
                  {results.maxes.maxMins.toFixed(0)}
                </div>
                <div className="text-xs text-[#6b7280]">min budget</div>
              </div>
            </div>
          </section>
        )}
      </main>
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
          className="flex-shrink-0 px-4 py-3 text-[#6b7280] hover:text-[#e8e9eb] hover:bg-[#1e2028] transition-colors"
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
          className="flex-shrink-0 px-4 py-3 text-[#6b7280] hover:text-[#e8e9eb] hover:bg-[#1e2028] transition-colors"
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
