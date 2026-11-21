/**
 * Unit Tests for Poisson & Dixon-Coles Probability Engine
 * 
 * Tests:
 * 1. Poisson PMF and Factorial accuracy
 * 2. Strict 100.0% sum for mutually exclusive market pairs (Over/Under, BTTS Yes/No, 1X2)
 * 3. Omitted mass quantification and grid truncation bounds
 * 4. Zero and high lambda bounds handling
 * 5. Dixon-Coles low-score dependency parameters
 */

import {
  factorial,
  poissonProb,
  dixonColesTau,
  calculatePoissonProbabilities,
} from './poissonModel';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number = 0.15, message: string = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`Expected ~${expected}, got ${actual}. ${message}`);
  }
}

export function runPoissonTests() {
  console.log('🧪 Starting Poisson & Dixon-Coles Mathematical Tests...');

  // 1. Factorial tests
  assert(factorial(0) === 1, 'factorial(0) must equal 1');
  assert(factorial(1) === 1, 'factorial(1) must equal 1');
  assert(factorial(4) === 24, 'factorial(4) must equal 24');
  assert(factorial(6) === 720, 'factorial(6) must equal 720');

  // 2. Poisson PMF tests
  // P(X = 0; lambda = 1.0) = e^-1 ~= 0.367879
  assertClose(poissonProb(0, 1.0), 0.367879, 0.0001, 'poissonProb(0, 1.0)');
  // P(X = 1; lambda = 1.0) = e^-1 ~= 0.367879
  assertClose(poissonProb(1, 1.0), 0.367879, 0.0001, 'poissonProb(1, 1.0)');
  // P(X = 2; lambda = 2.0) = (4 * e^-2) / 2 = 2 * e^-2 ~= 0.27067
  assertClose(poissonProb(2, 2.0), 0.27067, 0.0001, 'poissonProb(2, 2.0)');
  // Edge case lambda <= 0
  assert(poissonProb(0, 0) === 1, 'poissonProb(0, 0) should be 1');
  assert(poissonProb(1, 0) === 0, 'poissonProb(1, 0) should be 0');

  // 3. Dixon-Coles Tau tests
  const tau00 = dixonColesTau(0, 0, 1.5, 1.2, -0.11);
  assert(tau00 > 1.0, 'Dixon-Coles tau(0,0) must inflate 0-0 probability when rho is negative');
  const tau01 = dixonColesTau(0, 1, 1.5, 1.2, -0.11);
  assert(tau01 < 1.0, 'Dixon-Coles tau(0,1) must deflate 0-1 probability when rho is negative');
  const tau22 = dixonColesTau(2, 2, 1.5, 1.2, -0.11);
  assert(tau22 === 1.0, 'Dixon-Coles tau(2,2) must be exactly 1.0 for scores >= 2');

  // 4. Comprehensive market sum and normalization tests for typical match (1.6 vs 1.3 xG)
  const res = calculatePoissonProbabilities(1.6, 1.3, 7, true);
  const m = res.markets;

  // Mutually exclusive pair sums
  assertClose(m.homeWin + m.draw + m.awayWin, 100.0, 0.1, '1X2 must sum to 100%');
  assertClose(m.over15 + m.under15, 100.0, 0.1, 'Over 1.5 + Under 1.5 must sum to 100%');
  assertClose(m.over25 + m.under25, 100.0, 0.1, 'Over 2.5 + Under 2.5 must sum to 100%');
  assertClose(m.over35 + m.under35, 100.0, 0.1, 'Over 3.5 + Under 3.5 must sum to 100%');
  assertClose(m.bttsYes + m.bttsNo, 100.0, 0.1, 'BTTS Yes + BTTS No must sum to 100%');
  assertClose(m.firstHalfOver05 + m.firstHalfUnder05, 100.0, 0.1, 'FH Over 0.5 + FH Under 0.5 must sum to 100%');
  assertClose(m.firstHalfOver15 + m.firstHalfUnder15, 100.0, 0.1, 'FH Over 1.5 + FH Under 1.5 must sum to 100%');
  assertClose(m.firstHalfHomeWin + m.firstHalfDraw + m.firstHalfAwayWin, 100.0, 0.1, 'FH 1X2 must sum to 100%');

  // Omitted probability mass must be quantified and positive
  assert(res.omittedProbabilityMass >= 0, 'Omitted probability mass must be >= 0');
  assert(res.omittedProbabilityMass < 0.05, 'Omitted mass for maxGoals=7 should be small (< 5%)');
  assert(res.gridSum > 0.95, 'Grid sum must cover > 95% of distribution');

  // 5. Edge cases: High-scoring match (e.g. 3.5 vs 2.8)
  const highScoring = calculatePoissonProbabilities(3.5, 2.8, 7, true);
  assert(highScoring.markets.over25 > highScoring.markets.under25, 'High xG must favor Over 2.5');
  assertClose(
    highScoring.markets.homeWin + highScoring.markets.draw + highScoring.markets.awayWin,
    100.0,
    0.1,
    'High xG 1X2 must sum to 100%'
  );
  assertClose(
    highScoring.markets.bttsYes + highScoring.markets.bttsNo,
    100.0,
    0.1,
    'High xG BTTS must sum to 100%'
  );

  // 6. Edge cases: Low-scoring defensive fixture (e.g. 0.6 vs 0.5)
  const lowScoring = calculatePoissonProbabilities(0.6, 0.5, 7, true);
  assert(lowScoring.markets.under25 > lowScoring.markets.over25, 'Low xG must favor Under 2.5');
  assertClose(
    lowScoring.markets.over15 + lowScoring.markets.under15,
    100.0,
    0.1,
    'Low xG Over/Under 1.5 must sum to 100%'
  );
  assertClose(
    lowScoring.markets.homeWin + lowScoring.markets.draw + lowScoring.markets.awayWin,
    100.0,
    0.1,
    'Low xG 1X2 must sum to 100%'
  );

  console.log('✅ ALL POISSON & DIXON-COLES TESTS PASSED!');
}

// Run when executed directly
runPoissonTests();
