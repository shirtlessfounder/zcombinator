// API Request/Response types for standalone API communication

// Claim Info Request/Response
export interface ClaimInfoResponse {
  walletAddress: string;
  tokenAddress: string;
  totalClaimed: string;
  availableToClaim: string;
  maxClaimableNow: string;
  tokensPerPeriod: string;
  inflationPeriods: number;
  tokenLaunchTime: string | Date;
  nextInflationTime: string | Date;
  canClaimNow: boolean;
  timeUntilNextClaim: number;
}

// Mint Request/Response
export interface MintClaimRequest {
  tokenAddress: string;
  userWallet: string;
  claimAmount: string;
}

export interface MintClaimResponse {
  success: true;
  transaction: string; // base58 encoded unsigned transaction
  transactionKey: string;
  claimAmount: string;
  message: string;
}

// Confirm Request/Response
export interface ConfirmClaimRequest {
  signedTransaction: string; // base58 encoded signed transaction
  transactionKey: string;
}

export interface ConfirmClaimResponse {
  success: true;
  transactionSignature: string;
  tokenAddress: string;
  claimAmount: string;
  confirmation: any; // Solana confirmation object
}

// Error Response (used by all endpoints)
export interface ApiErrorResponse {
  error: string;
  details?: string;
}

// Union types for API responses
export type ClaimInfoResult = ClaimInfoResponse | ApiErrorResponse;
export type MintClaimResult = MintClaimResponse | ApiErrorResponse;
export type ConfirmClaimResult = ConfirmClaimResponse | ApiErrorResponse;

// Type guards to check if response is an error
export function isApiError(response: any): response is ApiErrorResponse {
  return response && typeof response.error === 'string';
}

export function isClaimInfoResponse(response: ClaimInfoResult): response is ClaimInfoResponse {
  return !isApiError(response);
}

export function isMintClaimResponse(response: MintClaimResult): response is MintClaimResponse {
  return !isApiError(response);
}

export function isConfirmClaimResponse(response: ConfirmClaimResult): response is ConfirmClaimResponse {
  return !isApiError(response);
}