import axios from 'axios';
import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config';

/**
 * Test script for the fee claim API endpoints
 *
 * Tests claiming fees from a Meteora DAMM v2 pool and distributing
 * them to configured recipients.
 *
 * Required ENV variables:
 * - PAYER_PRIVATE_KEY: Private key of wallet to pay transaction fees (Base58)
 * - RPC_URL: Solana RPC endpoint (required for simulation mode)
 *
 * Optional ENV variables:
 * - API_URL: Base URL for API (defaults to https://api.zcombinator.io)
 */

// Pool address to claim fees from
const POOL_ADDRESS = 'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1';

// Set to true to simulate the transaction instead of submitting to /confirm
const SIMULATE_ONLY = true;

async function testFeeClaim() {
  // Configuration
  const API_URL = process.env.API_URL || 'https://api.zcombinator.io';
  const PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL;

  // Validate private key is provided
  if (!PAYER_PRIVATE_KEY) {
    console.error('✗ Error: PAYER_PRIVATE_KEY environment variable is required');
    console.error('Usage: PAYER_PRIVATE_KEY=<base58-private-key> tsx test-fee-claim.ts');
    process.exit(1);
  }

  if (SIMULATE_ONLY && !RPC_URL) {
    console.error('✗ Error: RPC_URL environment variable is required for simulation mode');
    process.exit(1);
  }

  // Create keypair from private key and derive the public key from it
  const payerKeypair = Keypair.fromSecretKey(bs58.decode(PAYER_PRIVATE_KEY));
  const PAYER_PUBLIC_KEY = payerKeypair.publicKey.toBase58();

  console.log('Testing Fee Claim Endpoint');
  console.log('=========================');
  console.log(`Mode: ${SIMULATE_ONLY ? 'SIMULATION' : 'LIVE'}`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Pool Address: ${POOL_ADDRESS}`);
  console.log(`Payer Public Key: ${PAYER_PUBLIC_KEY}`);
  console.log();

  try {
    // Step 1: Call the /fee-claim/claim endpoint
    console.log('Step 1: Calling /fee-claim/claim...');
    const claimResponse = await axios.post(`${API_URL}/fee-claim/claim`, {
      payerPublicKey: PAYER_PUBLIC_KEY,
      poolAddress: POOL_ADDRESS
    });

    console.log('\nClaim response received:');
    console.log(JSON.stringify(claimResponse.data, null, 2));

    if (!claimResponse.data.success) {
      console.error('\n✗ Claim failed');
      return;
    }

    console.log('\n✓ Claim successful!');
    console.log(`Request ID: ${claimResponse.data.requestId}`);
    console.log(`Pool Address: ${claimResponse.data.poolAddress}`);
    console.log(`Token A Mint: ${claimResponse.data.tokenAMint}`);
    console.log(`Token B Mint: ${claimResponse.data.tokenBMint}`);
    console.log(`Token B is native SOL: ${claimResponse.data.isTokenBNativeSOL}`);
    console.log(`Total Positions: ${claimResponse.data.totalPositions}`);
    console.log(`Total Instructions: ${claimResponse.data.instructionsCount}`);
    console.log(`Estimated Fees:`);
    console.log(`  Token A: ${claimResponse.data.estimatedFees.tokenA}`);
    console.log(`  Token B: ${claimResponse.data.estimatedFees.tokenB}`);
    console.log(`Fee Recipients:`);
    for (const recipient of claimResponse.data.feeRecipients) {
      console.log(`  ${recipient.address}: ${recipient.percent}%`);
    }

    // Step 2: Sign the transaction
    console.log('\nStep 2: Signing transaction...');
    const unsignedTransaction = claimResponse.data.transaction;
    const requestId = claimResponse.data.requestId;

    // Deserialize the transaction
    const transactionBuffer = bs58.decode(unsignedTransaction);
    const transaction = Transaction.from(transactionBuffer);

    // Sign with the payer keypair
    transaction.partialSign(payerKeypair);

    // Serialize the signed transaction (requireAllSignatures: false because LP owner hasn't signed yet)
    const signedTransaction = bs58.encode(transaction.serialize({ requireAllSignatures: false }));

    console.log('✓ Transaction signed');

    if (SIMULATE_ONLY) {
      // Step 3: Simulate the transaction to preview balance changes
      console.log('\nStep 3: Simulating transaction...');

      const connection = new Connection(RPC_URL!, 'confirmed');

      // Get accounts involved in the transaction for balance tracking
      const accountKeys = transaction.compileMessage().accountKeys;
      const feeRecipients = claimResponse.data.feeRecipients as { address: string; percent: number }[];
      const lpOwnerAddress = claimResponse.data.lpOwnerAddress;

      // Get pre-simulation balances for fee recipients
      console.log('\nPre-simulation balances:');
      const preBalances: Record<string, { sol: number; tokenA?: number; tokenB?: number }> = {};

      for (const recipient of feeRecipients) {
        const pubkey = new PublicKey(recipient.address);
        const solBalance = await connection.getBalance(pubkey);
        preBalances[recipient.address] = { sol: solBalance / 1e9 };
        console.log(`  ${recipient.address.substring(0, 8)}...:`);
        console.log(`    SOL: ${preBalances[recipient.address].sol}`);
      }

      // Simulate the transaction
      const simulation = await connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (simulation.value.err) {
        console.log('\n✗ Simulation failed:');
        console.log(`  Error: ${JSON.stringify(simulation.value.err)}`);
        if (simulation.value.logs) {
          console.log('\n  Logs:');
          for (const log of simulation.value.logs) {
            console.log(`    ${log}`);
          }
        }
        return;
      }

      console.log('\n✓ Simulation successful!');
      console.log(`  Compute units consumed: ${simulation.value.unitsConsumed}`);

      // Show post-simulation balances from simulation results
      if (simulation.value.accounts) {
        console.log('\nPost-simulation account states:');
        for (let i = 0; i < accountKeys.length && i < simulation.value.accounts.length; i++) {
          const account = simulation.value.accounts[i];
          if (account) {
            const pubkey = accountKeys[i].toBase58();
            const isRecipient = feeRecipients.some(r => r.address === pubkey);
            if (isRecipient) {
              console.log(`  ${pubkey.substring(0, 8)}...: ${account.lamports / 1e9} SOL`);
            }
          }
        }
      }

      // Show logs
      if (simulation.value.logs && simulation.value.logs.length > 0) {
        console.log('\nTransaction logs:');
        for (const log of simulation.value.logs) {
          // Filter to show relevant logs
          if (log.includes('Transfer') || log.includes('success') || log.includes('Program log')) {
            console.log(`  ${log}`);
          }
        }
      }

      console.log('\n=========================');
      console.log('SIMULATION MODE - Transaction was not submitted');
      console.log('Set SIMULATE_ONLY = false to execute for real');
      console.log('=========================');

    } else {
      process.exit(0);
      // Step 3: Submit to confirm endpoint
      console.log('\nStep 3: Calling /fee-claim/confirm...');
      const confirmResponse = await axios.post(`${API_URL}/fee-claim/confirm`, {
        signedTransaction,
        requestId
      });

      console.log('\nConfirm response received:');
      console.log(JSON.stringify(confirmResponse.data, null, 2));

      if (confirmResponse.data.success) {
        console.log('\n✓ Fee claim confirmed!');
        console.log(`Signature: ${confirmResponse.data.signature}`);
        console.log(`Pool: ${confirmResponse.data.poolAddress}`);
        console.log(`Claimed Fees:`);
        console.log(`  Token A: ${confirmResponse.data.estimatedFees.tokenA}`);
        console.log(`  Token B: ${confirmResponse.data.estimatedFees.tokenB}`);
        console.log(`Fee Recipients:`);
        for (const recipient of confirmResponse.data.feeRecipients) {
          console.log(`  ${recipient.address}: ${recipient.percent}%`);
        }
        console.log(`Solscan: https://solscan.io/tx/${confirmResponse.data.signature}`);
      }
    }

  } catch (error: any) {
    console.error('\n✗ Error occurred:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Error: ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error.request) {
      console.error('No response received from server');
      console.error(error.message);
    } else {
      console.error(error.message);
    }
  }
}

// Run the test
testFeeClaim();
