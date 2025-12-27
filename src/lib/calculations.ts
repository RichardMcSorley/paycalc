export interface CalculationSettings {
  perPickup: number;       // minutes per pickup
  perDrop: number;         // minutes per drop
  perItem: number;         // minutes per item (shopping)
  avgSpeed: number;        // mph
  expectedPay: number;     // $/hour target
  maxOrdersPerHour: number; // max orders possible per hour
  return1Drop: number;     // return % for 1 drop
  return2Drop: number;     // return % for 2 drops
}

export interface MaxesInput {
  pay: number;
  pickups: number;
  drops: number;
}

export interface MaxesResult {
  maxMins: number;
  fixedTime: number;
  maxMiles: number;
  maxItems: number;
}

export interface PayReqInput {
  pickups: number;
  drops: number;
  miles: number;
  items: number;
}

export interface PayReqResult {
  pickupTime: number;
  travelTime: number;
  dropTime: number;
  shoppingTime: number;
  returnDelta: number;
  totalMins: number;
  payReq: number;
}

export const DEFAULT_SETTINGS: CalculationSettings = {
  perPickup: 5,
  perDrop: 2,
  perItem: 1.5,
  avgSpeed: 35,
  expectedPay: 21,
  maxOrdersPerHour: 3,
  return1Drop: 100,
  return2Drop: 50
};

export function calculateMaxes(
  input: MaxesInput,
  settings: CalculationSettings = DEFAULT_SETTINGS
): MaxesResult {
  const { pay, pickups, drops } = input;
  const { perPickup, perDrop, perItem, avgSpeed, expectedPay, return1Drop, return2Drop } = settings;

  // Get return percent based on drops
  const returnPercent = drops >= 2 ? return2Drop : return1Drop;

  // Max minutes you can spend for this pay
  const maxMins = (pay / expectedPay) * 60;

  // Fixed time costs
  const pickupTime = pickups * perPickup;
  const dropTime = drops * perDrop;
  const fixedTime = pickupTime + dropTime;

  // Remaining time for travel + return
  const remainingTime = maxMins - fixedTime;

  // Max miles (no shopping)
  const travelMultiplier = 1 + (returnPercent / 100);
  const maxTravelTime = remainingTime / travelMultiplier;
  const maxMiles = (maxTravelTime * avgSpeed) / 60;

  // Max items (no travel - theoretical max)
  const maxItems = remainingTime / perItem;

  return {
    maxMins: Math.round(maxMins * 100) / 100,
    fixedTime,
    maxMiles: Math.round(maxMiles * 100) / 100,
    maxItems: Math.floor(maxItems)
  };
}

export function calculatePayReq(
  input: PayReqInput,
  settings: CalculationSettings = DEFAULT_SETTINGS
): PayReqResult {
  const { pickups, drops, miles, items } = input;
  const { perPickup, perDrop, perItem, avgSpeed, expectedPay, return1Drop, return2Drop } = settings;

  // Get return percent based on drops
  const returnPercent = drops >= 2 ? return2Drop : return1Drop;

  const travelTime = (miles / avgSpeed) * 60;
  const pickupTime = pickups * perPickup;
  const dropTime = drops * perDrop;
  const shoppingTime = items * perItem;
  const returnDelta = travelTime * (returnPercent / 100);

  const totalMins = pickupTime + travelTime + dropTime + shoppingTime + returnDelta;
  const payReq = totalMins * (expectedPay / 60);

  return {
    pickupTime,
    travelTime: Math.round(travelTime * 100) / 100,
    dropTime,
    shoppingTime,
    returnDelta: Math.round(returnDelta * 100) / 100,
    totalMins: Math.round(totalMins * 100) / 100,
    payReq: Math.round(payReq * 100) / 100
  };
}

// Full offer evaluation
export interface OfferInput {
  pay: number;
  pickups?: number;
  drops?: number;
  miles?: number;
  items?: number;
}

export type Verdict = 'good' | 'decent' | 'bad';

export interface OfferEvaluation {
  // Verdict
  verdict: Verdict;
  verdictEmoji: string;
  verdictText: string;

  // Key metrics
  effectiveHourly: number;
  requiredPay: number;
  difference: number;
  totalMinutes: number;

  // Limits (when no miles provided)
  maxMiles: number;
  maxItems: number;
  maxMinutes: number;

  // Time breakdown
  breakdown: {
    pickup: number;
    travel: number;
    drop: number;
    shopping: number;
    return: number;
  };

  // Summary for display
  summary: string;
}

export function evaluateOffer(
  input: OfferInput,
  settings: CalculationSettings = DEFAULT_SETTINGS
): OfferEvaluation {
  const { pay, pickups = 1, drops = 1, miles = 0, items = 0 } = input;

  // Calculate maxes
  const maxes = calculateMaxes({ pay, pickups, drops }, settings);

  // Calculate pay required
  const payReq = calculatePayReq({ pickups, drops, miles, items }, settings);

  // Calculate effective hourly
  const ordersPerHour = payReq.totalMins > 0
    ? Math.min(settings.maxOrdersPerHour, 60 / payReq.totalMins)
    : 0;
  const effectiveHourly = Math.round(pay * ordersPerHour * 100) / 100;

  // Determine verdict
  const meetsRequired = pay >= payReq.payReq;
  let verdict: Verdict;
  let verdictEmoji: string;
  let verdictText: string;

  if (!meetsRequired) {
    verdict = 'bad';
    verdictEmoji = '🔴';
    verdictText = 'BAD';
  } else if (effectiveHourly >= settings.expectedPay) {
    verdict = 'good';
    verdictEmoji = '🟢';
    verdictText = 'GOOD';
  } else {
    verdict = 'decent';
    verdictEmoji = '🟡';
    verdictText = 'DECENT';
  }

  const difference = Math.round((pay - payReq.payReq) * 100) / 100;

  // Build summary
  let summary: string;
  if (miles > 0) {
    summary = `${verdictEmoji} ${verdictText}: $${effectiveHourly}/hr effective | ${payReq.totalMins.toFixed(1)} min | ${difference >= 0 ? '+' : ''}$${difference.toFixed(2)} vs required`;
  } else {
    summary = `${verdictEmoji} $${pay} = Max ${maxes.maxMiles.toFixed(1)} mi in ${maxes.maxMins.toFixed(0)} min`;
  }

  return {
    verdict,
    verdictEmoji,
    verdictText,
    effectiveHourly,
    requiredPay: payReq.payReq,
    difference,
    totalMinutes: payReq.totalMins,
    maxMiles: maxes.maxMiles,
    maxItems: maxes.maxItems,
    maxMinutes: maxes.maxMins,
    breakdown: {
      pickup: payReq.pickupTime,
      travel: payReq.travelTime,
      drop: payReq.dropTime,
      shopping: payReq.shoppingTime,
      return: payReq.returnDelta
    },
    summary
  };
}
