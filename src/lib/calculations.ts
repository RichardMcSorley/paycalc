export interface CalculationSettings {
  perPickup: number;       // minutes per pickup
  perDrop: number;         // minutes per drop
  perItem: number;         // minutes per item (shopping)
  avgSpeed: number;        // mph
  expectedPay: number;     // $/hour target
  minHourlyPay: number;    // minimum $/hour floor (0 = disabled)
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
  minHourlyPay: 0,
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

  // Thresholds - max values to achieve each verdict
  thresholds: {
    // Miles (given current pay, pickups, drops, items)
    maxMilesForDecent: number;
    maxMilesForGood: number | null;
    // Time (given current pay)
    maxTimeForDecent: number;
    maxTimeForGood: number | null;
    // Items (given current pay, pickups, drops, miles)
    maxItemsForDecent: number;
    maxItemsForGood: number | null;
    // Pay (given current time)
    minPayForGood: number;
    // Whether GOOD is achievable
    canBeGood: boolean;
    // Before BAD thresholds (for GOOD orders - when does it become BAD)
    maxMilesBeforeBad: number | null;  // null = infinite (capped by maxOrdersPerHour)
    maxTimeBeforeBad: number | null;
    maxItemsBeforeBad: number | null;
    minPayBeforeBad: number;
  };

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

  // Calculate maxes (theoretical max with no shopping)
  const maxes = calculateMaxes({ pay, pickups, drops }, settings);

  // Calculate pay required for current inputs
  const payReq = calculatePayReq({ pickups, drops, miles, items }, settings);

  // Calculate effective hourly
  const ordersPerHour = payReq.totalMins > 0
    ? Math.min(settings.maxOrdersPerHour, 60 / payReq.totalMins)
    : 0;
  const effectiveHourly = Math.round(pay * ordersPerHour * 100) / 100;

  // Determine verdict
  // When minHourlyPay is set, use it as the floor; otherwise use the calculated payReq
  const meetsFloor = settings.minHourlyPay > 0
    ? effectiveHourly >= settings.minHourlyPay
    : pay >= payReq.payReq;
  let verdict: Verdict;
  let verdictEmoji: string;
  let verdictText: string;

  if (!meetsFloor) {
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

  // Calculate thresholds - max miles for DECENT and GOOD given current pay, pickups, drops, items
  const { perPickup, perDrop, perItem, avgSpeed, expectedPay, maxOrdersPerHour, return1Drop, return2Drop } = settings;
  const returnPercent = drops >= 2 ? return2Drop : return1Drop;
  const travelMultiplier = 1 + (returnPercent / 100);

  // Fixed time (non-travel time)
  const fixedTime = (pickups * perPickup) + (drops * perDrop) + (items * perItem);

  // Max minutes for this pay
  const maxMins = (pay / expectedPay) * 60;

  // Can this offer ever be GOOD?
  // GOOD requires effectiveHourly >= expectedPay
  // At best (shortest trip), effectiveHourly = pay * maxOrdersPerHour
  const canBeGood = pay * maxOrdersPerHour >= expectedPay;

  // TIME THRESHOLDS
  // Max time for DECENT/GOOD is simply maxMins
  const maxTimeForDecent = Math.round(maxMins * 10) / 10;
  const maxTimeForGood = canBeGood ? maxTimeForDecent : null;

  // MILES THRESHOLDS (given current pickups, drops, items)
  // Max miles for DECENT: totalMins <= maxMins
  const availableTimeForTravel = maxMins - fixedTime;
  const maxTravelTime = availableTimeForTravel / travelMultiplier;
  const maxMilesForDecent = Math.max(0, Math.round((maxTravelTime * avgSpeed / 60) * 10) / 10);
  const maxMilesForGood = canBeGood ? maxMilesForDecent : null;

  // ITEMS THRESHOLDS (given current pickups, drops, miles)
  // Fixed time without items
  const travelTime = (miles / avgSpeed) * 60;
  const returnTime = travelTime * (returnPercent / 100);
  const fixedTimeWithoutItems = (pickups * perPickup) + (drops * perDrop) + travelTime + returnTime;
  const availableTimeForItems = maxMins - fixedTimeWithoutItems;
  const maxItemsForDecent = Math.max(0, Math.floor(availableTimeForItems / perItem));
  const maxItemsForGood = canBeGood ? maxItemsForDecent : null;

  // PAY THRESHOLD (given current time)
  // minPayForGood = expectedPay / ordersPerHour
  const minPayForGood = ordersPerHour > 0
    ? Math.round((expectedPay / ordersPerHour) * 100) / 100
    : 0;

  // BEFORE BAD THRESHOLDS (for GOOD orders - when does it become BAD)
  // These calculate how much MORE time/miles/items until BAD, or how much LESS pay
  let maxTimeBeforeBad: number | null = null;
  let maxMilesBeforeBad: number | null = null;
  let maxItemsBeforeBad: number | null = null;
  let minPayBeforeBad = 0;

  // Check if we're CURRENTLY capped (ordersPerHour = maxOrdersPerHour)
  // Cap threshold: totalMins <= 60/maxOrdersPerHour
  const capThresholdMins = 60 / maxOrdersPerHour;
  const isCurrentlyCapped = payReq.totalMins <= capThresholdMins;

  if (settings.minHourlyPay > 0) {
    // BAD when effectiveHourly < minHourlyPay
    // effectiveHourly = pay * min(maxOrdersPerHour, 60/totalMins)

    if (isCurrentlyCapped) {
      // Currently capped - adding time won't reduce effectiveHourly until we pass the cap threshold
      // effectiveHourly stays at pay * maxOrdersPerHour until totalMins > capThresholdMins
      const cappedEffectiveHourly = pay * maxOrdersPerHour;
      if (cappedEffectiveHourly >= settings.minHourlyPay) {
        // Even after uncapping, calculate when it would hit minHourlyPay
        // After cap: effectiveHourly = pay * 60 / totalMins
        // totalMins = pay * 60 / minHourlyPay
        maxTimeBeforeBad = Math.round((pay * 60 / settings.minHourlyPay) * 10) / 10;
      } else {
        // Would be BAD immediately after uncapping
        maxTimeBeforeBad = capThresholdMins;
      }
    } else {
      // Not capped - calculate when effectiveHourly drops to minHourlyPay
      // pay * 60 / totalMins = minHourlyPay
      // totalMins = pay * 60 / minHourlyPay
      maxTimeBeforeBad = Math.round((pay * 60 / settings.minHourlyPay) * 10) / 10;
    }

    // Convert time to miles (given current pickups, drops, items)
    const availableTimeForTravel = maxTimeBeforeBad - fixedTime;
    const maxTravelTimeBeforeBad = availableTimeForTravel / travelMultiplier;
    maxMilesBeforeBad = Math.max(0, Math.round((maxTravelTimeBeforeBad * avgSpeed / 60) * 10) / 10);

    // Convert time to items (given current pickups, drops, miles)
    const availableTimeForItemsBeforeBad = maxTimeBeforeBad - fixedTimeWithoutItems;
    maxItemsBeforeBad = Math.max(0, Math.floor(availableTimeForItemsBeforeBad / perItem));

    // Min pay before BAD (when effectiveHourly = minHourlyPay)
    minPayBeforeBad = Math.round((settings.minHourlyPay / ordersPerHour) * 100) / 100;
  } else {
    // BAD when pay < payReq (based on expectedPay rate)
    // This is the same as maxMins
    maxTimeBeforeBad = maxMins;
    maxMilesBeforeBad = maxMilesForDecent;
    maxItemsBeforeBad = maxItemsForDecent;
    minPayBeforeBad = payReq.payReq;
  }

  // Build summary
  let summary: string;
  if (miles > 0) {
    summary = `${verdictEmoji} ${verdictText}: $${effectiveHourly}/hr | ${payReq.totalMins.toFixed(0)} min`;
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
    thresholds: {
      maxMilesForDecent,
      maxMilesForGood,
      maxTimeForDecent,
      maxTimeForGood,
      maxItemsForDecent,
      maxItemsForGood,
      minPayForGood,
      canBeGood,
      maxMilesBeforeBad,
      maxTimeBeforeBad,
      maxItemsBeforeBad,
      minPayBeforeBad
    },
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
