/*
 * Z Combinator - Meteora DLMM Liquidity Deposit Test Script
 *
 * This script tests depositing liquidity into a Meteora DLMM
 * (Dynamic Liquidity Market Maker) pool position. It mirrors the production flow:
 * 1. Manager wallet transfers tokens to LP owner
 * 2. LP owner deposits into the DLMM pool
 *
 * Required ENV variables:
 * - RPC_URL: Solana RPC endpoint
 * - DLMM_POOL_ADDRESS: Meteora DLMM pool address for liquidity management
 * - LP_OWNER_PRIVATE_KEY: Private key of wallet that owns/will own the LP position (Base58)
 * - MANAGER_PRIVATE_KEY: Private key of manager wallet that holds the tokens to deposit
 * - PAYER_PRIVATE_KEY: (Optional) Private key for fee payer, defaults to LP owner
 *
 * Optional ENV variables:
 * - DEPOSIT_TOKEN_X_AMOUNT: Amount of Token X to deposit (in UI units, e.g., "1000.5")
 * - DEPOSIT_TOKEN_Y_AMOUNT: Amount of Token Y to deposit (in UI units, e.g., "0.5")
 */

import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import bs58 from 'bs58';
import { getMint, getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, createTransferInstruction, NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';

dotenv.config();

// Set to true to simulate transactions without executing them
const SIMULATE_ONLY = false;

// Deposit amounts (in UI units - will be converted to raw amounts)
const DEPOSIT_TOKEN_X_AMOUNT = '43289.778283'; // Default 1000 Token X
const DEPOSIT_TOKEN_Y_AMOUNT = '0.121121875'; // Default 0.01 Token Y (SOL)

async function testDlmmDeposit() {
  try {
    console.log('\n🧪 Meteora DLMM Liquidity Deposit Test Script');
    console.log(`Mode: ${SIMULATE_ONLY ? '🔍 SIMULATION ONLY' : '⚡ LIVE EXECUTION'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const DLMM_POOL_ADDRESS = process.env.DLMM_POOL_ADDRESS;
    const LP_OWNER_PRIVATE_KEY = process.env.LP_OWNER_PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
    const MANAGER_PRIVATE_KEY = process.env.MANAGER_PRIVATE_KEY;
    const FEE_PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY || LP_OWNER_PRIVATE_KEY;

    if (!RPC_URL) {
      throw new Error('RPC_URL not set in environment');
    }
    if (!DLMM_POOL_ADDRESS) {
      throw new Error('DLMM_POOL_ADDRESS not set in environment');
    }
    if (!LP_OWNER_PRIVATE_KEY) {
      throw new Error('LP_OWNER_PRIVATE_KEY not set in environment');
    }
    if (!MANAGER_PRIVATE_KEY) {
      throw new Error('MANAGER_PRIVATE_KEY not set in environment');
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const manager = Keypair.fromSecretKey(bs58.decode(MANAGER_PRIVATE_KEY));
    const feePayer = FEE_PAYER_PRIVATE_KEY
      ? Keypair.fromSecretKey(bs58.decode(FEE_PAYER_PRIVATE_KEY))
      : lpOwner;
    const poolAddress = new PublicKey(DLMM_POOL_ADDRESS);

    console.log('Configuration:');
    console.log(`  Pool:             ${poolAddress.toBase58()}`);
    console.log(`  LP Owner:         ${lpOwner.publicKey.toBase58()}`);
    console.log(`  Manager Wallet:   ${manager.publicKey.toBase58()}`);
    console.log(`  Fee Payer:        ${feePayer.publicKey.toBase58()}`);
    console.log(`  Deposit X:        ${DEPOSIT_TOKEN_X_AMOUNT}`);
    console.log(`  Deposit Y:        ${DEPOSIT_TOKEN_Y_AMOUNT}`);
    console.log('');

    // Step 1: Create DLMM instance
    console.log('📊 Step 1: Loading DLMM pool...');
    const dlmmPool = await DLMM.create(connection, poolAddress);
    const lbPair = dlmmPool.lbPair;

    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;
    const binStep = lbPair.binStep;
    const activeId = lbPair.activeId;

    console.log(`  Token X Mint: ${tokenXMint.toBase58()}`);
    console.log(`  Token Y Mint: ${tokenYMint.toBase58()}`);
    console.log(`  Bin Step: ${binStep} bps (${(binStep / 100).toFixed(2)}%)`);
    console.log(`  Active Bin ID: ${activeId}`);
    console.log('');

    // Step 2: Get token mint info and calculate raw amounts
    console.log('💰 Step 2: Calculating deposit amounts...');

    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);

    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    const depositXRaw = new BN(
      Math.floor(parseFloat(DEPOSIT_TOKEN_X_AMOUNT) * Math.pow(10, tokenXMintInfo.decimals))
    );
    const depositYRaw = new BN(
      Math.floor(parseFloat(DEPOSIT_TOKEN_Y_AMOUNT) * Math.pow(10, tokenYMintInfo.decimals))
    );

    console.log(`  Token X Decimals: ${tokenXMintInfo.decimals}`);
    console.log(`  Token Y Decimals: ${tokenYMintInfo.decimals}`);
    console.log(`  Token X is ${isTokenXNativeSOL ? 'native SOL' : 'SPL token'}`);
    console.log(`  Token Y is ${isTokenYNativeSOL ? 'native SOL' : 'SPL token'}`);
    console.log(`  Deposit X Amount: ${DEPOSIT_TOKEN_X_AMOUNT} (${depositXRaw.toString()} raw)`);
    console.log(`  Deposit Y Amount: ${DEPOSIT_TOKEN_Y_AMOUNT} ${isTokenYNativeSOL ? 'SOL' : ''} (${depositYRaw.toString()} raw)`);
    console.log('');

    // Step 3: Check for existing positions
    console.log('🔍 Step 3: Checking for existing positions...');

    const { userPositions, activeBin } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    console.log(`  Active Bin Price: ${activeBin.price}`);
    console.log(`  Found ${userPositions.length} existing position(s)`);

    let existingPosition = null;
    if (userPositions.length > 0) {
      existingPosition = userPositions[0];
      const posData = existingPosition.positionData;
      console.log(`  Using existing position: ${existingPosition.publicKey.toBase58()}`);
      console.log(`    Lower Bin ID: ${posData.lowerBinId}`);
      console.log(`    Upper Bin ID: ${posData.upperBinId}`);
      console.log(`    Current X Amount: ${posData.totalXAmount}`);
      console.log(`    Current Y Amount: ${posData.totalYAmount}`);
    } else {
      console.log('  No existing position found - will create new position');
    }
    console.log('');

    // Step 4: Build deposit transaction
    console.log('🔨 Step 4: Building deposit transaction...');

    const combinedTx = new Transaction();
    combinedTx.feePayer = feePayer.publicKey;

    // Get ATAs
    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);
    const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, manager.publicKey);
    const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, manager.publicKey);

    // Create LP owner ATAs if needed
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        feePayer.publicKey,
        lpOwnerTokenXAta,
        lpOwner.publicKey,
        tokenXMint
      )
    );
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        feePayer.publicKey,
        lpOwnerTokenYAta,
        lpOwner.publicKey,
        tokenYMint
      )
    );

    // Transfer Token X from manager to LP owner
    if (!depositXRaw.isZero()) {
      if (isTokenXNativeSOL) {
        // Transfer native SOL from manager, then wrap at LP owner
        console.log(`  Transferring ${DEPOSIT_TOKEN_X_AMOUNT} SOL from manager to LP owner (Token X)...`);
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: manager.publicKey,
            toPubkey: lpOwnerTokenXAta,
            lamports: depositXRaw.toNumber()
          }),
          createSyncNativeInstruction(lpOwnerTokenXAta)
        );
      } else {
        // Transfer SPL token from manager to LP owner
        console.log(`  Transferring ${DEPOSIT_TOKEN_X_AMOUNT} Token X from manager to LP owner...`);
        combinedTx.add(
          createTransferInstruction(
            managerTokenXAta,
            lpOwnerTokenXAta,
            manager.publicKey,
            BigInt(depositXRaw.toString())
          )
        );
      }
    }

    // Transfer Token Y from manager to LP owner
    if (!depositYRaw.isZero()) {
      if (isTokenYNativeSOL) {
        // Transfer native SOL from manager, then wrap at LP owner
        console.log(`  Transferring ${DEPOSIT_TOKEN_Y_AMOUNT} SOL from manager to LP owner (Token Y)...`);
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: manager.publicKey,
            toPubkey: lpOwnerTokenYAta,
            lamports: depositYRaw.toNumber()
          }),
          createSyncNativeInstruction(lpOwnerTokenYAta)
        );
      } else {
        // Transfer SPL token from manager to LP owner
        console.log(`  Transferring ${DEPOSIT_TOKEN_Y_AMOUNT} Token Y from manager to LP owner...`);
        combinedTx.add(
          createTransferInstruction(
            managerTokenYAta,
            lpOwnerTokenYAta,
            manager.publicKey,
            BigInt(depositYRaw.toString())
          )
        );
      }
    }

    // Define position range (bins around active bin)
    const binRange = 34; // Number of bins on each side of active bin
    const minBinId = activeId - binRange;
    const maxBinId = activeId + binRange;

    console.log(`  Position range: Bin ${minBinId} to ${maxBinId} (${binRange * 2 + 1} bins)`);

    // Create position and add liquidity
    if (existingPosition) {
      // Add to existing position
      console.log('  Adding liquidity to existing position...');

      const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
        positionPubKey: existingPosition.publicKey,
        user: lpOwner.publicKey,
        totalXAmount: depositXRaw,
        totalYAmount: depositYRaw,
        strategy: {
          maxBinId: existingPosition.positionData.upperBinId,
          minBinId: existingPosition.positionData.lowerBinId,
          strategyType: 0, // Spot strategy
        },
        slippage: 100, // 1% slippage
      });

      // Handle both single transaction and array of transactions
      if (Array.isArray(addLiquidityTx)) {
        for (const tx of addLiquidityTx) {
          combinedTx.add(...tx.instructions);
        }
      } else {
        combinedTx.add(...addLiquidityTx.instructions);
      }
    } else {
      // Create new position
      console.log('  Creating new position with liquidity...');

      const newPositionKeypair = Keypair.generate();
      console.log(`  New position address: ${newPositionKeypair.publicKey.toBase58()}`);

      const createPositionTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPositionKeypair.publicKey,
        user: lpOwner.publicKey,
        totalXAmount: depositXRaw,
        totalYAmount: depositYRaw,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: 0, // Spot strategy
        },
        slippage: 100, // 1% slippage
      });

      // Handle both single transaction and array of transactions
      if (Array.isArray(createPositionTx)) {
        for (const tx of createPositionTx) {
          combinedTx.add(...tx.instructions);
        }
      } else {
        combinedTx.add(...createPositionTx.instructions);
      }

      // Need to sign with new position keypair
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      combinedTx.recentBlockhash = blockhash;

      // Sign with position keypair first
      combinedTx.partialSign(newPositionKeypair);
    }

    console.log(`  Combined transaction has ${combinedTx.instructions.length} instruction(s)`);
    console.log('');

    // Step 5: Simulate/Execute transaction
    const stepLabel = SIMULATE_ONLY ? '🔍 Step 5: Simulating deposit transaction...' : '📤 Step 5: Sending deposit transaction...';
    console.log(stepLabel);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    if (!combinedTx.recentBlockhash) {
      combinedTx.recentBlockhash = blockhash;
    }

    // Sign transaction (LP owner, manager, and fee payer if different)
    combinedTx.partialSign(lpOwner);
    combinedTx.partialSign(manager);
    if (!feePayer.publicKey.equals(lpOwner.publicKey) && !feePayer.publicKey.equals(manager.publicKey)) {
      combinedTx.partialSign(feePayer);
    }

    if (SIMULATE_ONLY) {
      // Simulate transaction
      const simulation = await connection.simulateTransaction(combinedTx);

      console.log(`  Deposit Transaction Simulation:`);
      if (simulation.value.err) {
        console.log(`    ❌ Error: ${JSON.stringify(simulation.value.err)}`);
        if (simulation.value.logs) {
          console.log(`    Logs:`);
          simulation.value.logs.forEach(log => console.log(`      ${log}`));
        }
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('❌ Simulation failed!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(1);
      } else {
        console.log(`    ✅ Success`);
        console.log(`    Compute Units: ${simulation.value.unitsConsumed || 'N/A'}`);
      }

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Simulation completed successfully!');
      console.log('\n📊 Summary:');
      console.log(`  Pool: ${poolAddress.toBase58()}`);
      console.log(`  Pool Type: DLMM (Bin Step: ${binStep} bps)`);
      console.log(`  Token X Mint: ${tokenXMint.toBase58()}`);
      console.log(`  Token Y Mint: ${tokenYMint.toBase58()}`);
      console.log(`\n  💧 Tokens to Deposit (from manager ${manager.publicKey.toBase58()}):`);
      console.log(`    Token X: ${DEPOSIT_TOKEN_X_AMOUNT} (${depositXRaw.toString()} raw)`);
      console.log(`    Token Y: ${DEPOSIT_TOKEN_Y_AMOUNT} ${isTokenYNativeSOL ? 'SOL' : ''} (${depositYRaw.toString()} raw)`);
      if (existingPosition) {
        console.log(`\n  📍 Adding to existing position: ${existingPosition.publicKey.toBase58()}`);
      } else {
        console.log(`\n  📍 Creating new position with range: Bin ${minBinId} to ${maxBinId}`);
      }
      console.log('\n⚠️  To execute for real, set SIMULATE_ONLY=false');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      // Send transaction
      const signature = await connection.sendRawTransaction(combinedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      console.log(`  Deposit TX: ${signature}`);
      console.log(`  Solscan: https://solscan.io/tx/${signature}`);

      // Wait for confirmation
      console.log('  Waiting for confirmation...');
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      console.log('  ✅ Transaction confirmed');
      console.log('');

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Deposit completed successfully!');
      console.log(`\nTransaction: https://solscan.io/tx/${signature}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testDlmmDeposit();
