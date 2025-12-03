// Server-side types for API endpoints
import { Request, Response } from 'express';

// Extended Express types for our API endpoints
export interface TypedRequest<T = any> extends Request {
  body: T;
}

export interface TypedResponse<T = any> extends Response {
  json: (body: T) => this;
}

// Claim endpoint request bodies
export interface MintClaimRequestBody {
  tokenAddress: string;
  userWallet: string;
  claimAmount: string;
}

export interface ConfirmClaimRequestBody {
  signedTransaction: string;
  transactionKey: string;
}

// Claim endpoint response bodies
export interface MintClaimResponseBody {
  success: true;
  transaction: string;
  transactionKey: string;
  claimAmount: string;
  message: string;
}

export interface ConfirmClaimResponseBody {
  success: true;
  transactionSignature: string;
  tokenAddress: string;
  claimAmount: string;
  confirmation: any;
}

export interface ClaimInfoResponseBody {
  walletAddress: string;
  tokenAddress: string;
  totalClaimed: string;
  availableToClaim: string;
  maxClaimableNow: string;
  tokensPerPeriod: string;
  inflationPeriods: number;
  tokenLaunchTime: Date;
  nextInflationTime: Date;
  canClaimNow: boolean;
  timeUntilNextClaim: number;
}

export interface ErrorResponseBody {
  error: string;
  details?: string;
  nextInflationTime?: Date;
}

// Typed endpoint handlers
export type MintClaimHandler = (
  req: TypedRequest<MintClaimRequestBody>,
  res: TypedResponse<MintClaimResponseBody | ErrorResponseBody>
) => Promise<void>;

export type ConfirmClaimHandler = (
  req: TypedRequest<ConfirmClaimRequestBody>,
  res: TypedResponse<ConfirmClaimResponseBody | ErrorResponseBody>
) => Promise<void>;

export type ClaimInfoHandler = (
  req: Request,
  res: TypedResponse<ClaimInfoResponseBody | ErrorResponseBody>
) => Promise<void>;