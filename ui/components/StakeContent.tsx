'use client';

import { useState, useEffect, useCallback, useMemo } from "react";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { useWallet } from '@/components/WalletProvider';
import { showToast } from '@/components/Toast';
import VaultIDL from '@/lib/vault-idl.json';
import { usePrivy } from '@privy-io/react-auth';
import { useTheme } from '@/contexts/ThemeContext';

const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");
const PROGRAM_ID = new PublicKey("6CETAFdgoMZgNHCcjnnQLN2pu5pJgUz8QQd7JzcynHmD");

interface SolanaWalletProvider {
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
}

interface WindowWithWallets extends Window {
  solana?: SolanaWalletProvider;
  solflare?: SolanaWalletProvider;
}

export function StakeContent() {
  const { wallet, isPrivyAuthenticated } = useWallet();
  const { login, authenticated, linkWallet } = usePrivy();
  const { theme } = useTheme();
  const mutedTextColor = theme === 'dark' ? '#B8B8B8' : '#717182';

  const [loading, setLoading] = useState(false);
  const [modalMode, setModalMode] = useState<"deposit" | "redeem">("deposit");
  const [amount, setAmount] = useState<string>("");
  const [redeemPercent, setRedeemPercent] = useState<string>("");

  const [zcBalance, setZcBalance] = useState<number>(0);
  const [vaultBalance, setVaultBalance] = useState<number>(0);
  const [userShareBalance, setUserShareBalance] = useState<number>(0);
  const [userShareValue, setUserShareValue] = useState<number>(0);
  const [exchangeRate, setExchangeRate] = useState<number>(0);
  const [zcTotalSupply, setZcTotalSupply] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [postTransactionRefreshing, setPostTransactionRefreshing] = useState(false);
  const [withdrawalsEnabled, setWithdrawalsEnabled] = useState<boolean>(true);
  const [copiedWallet, setCopiedWallet] = useState(false);

  const connection = useMemo(() => new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com"), []);

  const getProvider = useCallback(() => {
    if (typeof window === 'undefined') return null;

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) return null;

    try {
      const provider = new AnchorProvider(
        connection,
        walletProvider as unknown as AnchorProvider['wallet'],
        { commitment: "confirmed" }
      );
      return provider;
    } catch (error) {
      console.error("Failed to create provider:", error);
      return null;
    }
  }, [wallet, connection]);

  const getProgram = useCallback((): Program | null => {
    const provider = getProvider();
    if (!provider) return null;
    return new Program(VaultIDL as unknown as Program['idl'], provider);
  }, [getProvider]);

  const program = useMemo(() => getProgram(), [getProgram]);

  const calculateAPY = useCallback((): number => {
    if (vaultBalance === 0) return 0;
    const REWARD_TOKENS = 0;
    const rewardPerToken = REWARD_TOKENS / vaultBalance;
    const compoundingPeriodsPerYear = 52;
    return 100 * (Math.pow(1 + rewardPerToken, compoundingPeriodsPerYear) - 1);
  }, [vaultBalance]);

  const fetchZcBalance = useCallback(async () => {
    if (!wallet) {
      setZcBalance(0);
      return;
    }

    try {
      const userTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
      const userTokenAccountInfo = await getAccount(connection, userTokenAccount);
      const balance = Number(userTokenAccountInfo.amount) / 1_000_000;
      setZcBalance(balance);

      const mintInfo = await connection.getParsedAccountInfo(ZC_TOKEN_MINT);
      if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
        const supply = Number(mintInfo.value.data.parsed.info.supply) / 1_000_000;
        setZcTotalSupply(supply);
      }
    } catch {
      console.log("User ZC token account not found");
      setZcBalance(0);
    }
  }, [wallet, connection]);

  const fetchVaultData = useCallback(async (retryCount = 0, maxRetries = 3) => {
    try {
      setRefreshing(true);
      if (!program || !wallet) {
        console.log("No program or wallet available");
        return;
      }

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );

      try {
        const vaultStateAccountInfo = await connection.getAccountInfo(vaultState);
        if (vaultStateAccountInfo && vaultStateAccountInfo.data) {
          const vaultStateAccount = program.coder.accounts.decode("vaultState", vaultStateAccountInfo.data);
          setWithdrawalsEnabled(vaultStateAccount.operationsEnabled);
        } else {
          setWithdrawalsEnabled(false);
        }
      } catch (error) {
        console.error("Failed to fetch vault state:", error);
        setWithdrawalsEnabled(false);
      }

      try {
        const totalAssets = await program.methods
          .totalAssets()
          .accounts({
            vaultTokenAccount,
            mintOfTokenBeingSent: ZC_TOKEN_MINT,
          })
          .view();
        setVaultBalance(Number(totalAssets) / 1_000_000);
      } catch (error) {
        console.error("Failed to fetch vault metrics:", error);
        setVaultBalance(0);
      }

      try {
        const oneShare = new BN(1_000_000);
        const assetsForOneShare = await program.methods
          .previewRedeem(oneShare)
          .accounts({
            shareMint,
            vaultTokenAccount,
            mintOfTokenBeingSent: ZC_TOKEN_MINT,
          })
          .view();
        setExchangeRate(Number(assetsForOneShare) / 1_000_000);
      } catch (error) {
        console.error("Failed to fetch exchange rate:", error);
        setExchangeRate(1);
      }

      try {
        const userShareAccount = await getAssociatedTokenAddress(shareMint, wallet);
        const userShareAccountInfo = await getAccount(connection, userShareAccount);
        const shareBalance = Number(userShareAccountInfo.amount) / 1_000_000;
        setUserShareBalance(shareBalance);

        if (shareBalance > 0) {
          const assets = await program.methods
            .previewRedeem(new BN(userShareAccountInfo.amount.toString()))
            .accounts({
              shareMint,
              vaultTokenAccount,
              mintOfTokenBeingSent: ZC_TOKEN_MINT,
            })
            .view();
          setUserShareValue(Number(assets) / 1_000_000);
        } else {
          setUserShareValue(0);
        }
      } catch {
        console.log("User share account not found");
        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000;
          setTimeout(() => {
            fetchVaultData(retryCount + 1, maxRetries);
          }, delay);
          return;
        }
        setUserShareBalance(0);
        setUserShareValue(0);
      }
    } catch (error) {
      console.error("Failed to fetch vault data:", error);
    } finally {
      setRefreshing(false);
    }
  }, [wallet, connection, program]);

  useEffect(() => {
    if (wallet) {
      fetchZcBalance();
      fetchVaultData();
    }
  }, [wallet, fetchZcBalance, fetchVaultData]);

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount);
    if (!depositAmount || depositAmount <= 0) {
      showToast('error', 'Please enter a valid deposit amount');
      return;
    }

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      showToast('error', 'Please connect your wallet first');
      return;
    }

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const depositAmountBN = new BN(depositAmount * 1_000_000);

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [tokenAccountOwnerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_account_owner_pda")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );

      const senderTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
      const senderShareAccount = await getAssociatedTokenAddress(shareMint, wallet);

      const transaction = new Transaction();
      try {
        await getAccount(connection, senderShareAccount);
      } catch {
        const createATAIx = createAssociatedTokenAccountInstruction(
          wallet,
          senderShareAccount,
          wallet,
          shareMint,
          TOKEN_PROGRAM_ID
        );
        transaction.add(createATAIx);
      }

      const depositIx = await program.methods
        .deposit(depositAmountBN)
        .accounts({
          vaultState,
          tokenAccountOwnerPda,
          vaultTokenAccount,
          senderTokenAccount,
          senderShareAccount,
          shareMint,
          mintOfTokenBeingSent: ZC_TOKEN_MINT,
          signer: wallet,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(depositIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      showToast('success', `Staked ${depositAmount} ZC to the vault`);
      setAmount("");

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchVaultData(), fetchZcBalance()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Deposit failed:", error);
      showToast('error', error instanceof Error ? error.message : "Failed to deposit tokens");
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async () => {
    const redeemPercentNum = parseFloat(redeemPercent);
    if (!redeemPercentNum || redeemPercentNum <= 0 || redeemPercentNum > 100) {
      showToast('error', 'Please enter a valid percentage between 0 and 100');
      return;
    }

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      showToast('error', 'Please connect your wallet first');
      return;
    }

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );
      const userShareAccount = await getAssociatedTokenAddress(shareMint, wallet);
      const userShareAccountInfo = await getAccount(connection, userShareAccount);
      const totalShares = userShareAccountInfo.amount;
      const sharesToRedeem = (totalShares * BigInt(Math.floor(redeemPercentNum * 100))) / BigInt(10000);

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [tokenAccountOwnerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_account_owner_pda")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );

      const senderTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
      const senderShareAccount = userShareAccount;

      const transaction = new Transaction();

      try {
        await getAccount(connection, senderTokenAccount);
      } catch {
        const createATAIx = createAssociatedTokenAccountInstruction(
          wallet,
          senderTokenAccount,
          wallet,
          ZC_TOKEN_MINT,
          TOKEN_PROGRAM_ID
        );
        transaction.add(createATAIx);
      }

      const redeemIx = await program.methods
        .redeem(new BN(sharesToRedeem.toString()))
        .accounts({
          vaultState,
          tokenAccountOwnerPda,
          vaultTokenAccount,
          senderTokenAccount,
          senderShareAccount,
          shareMint,
          mintOfTokenBeingSent: ZC_TOKEN_MINT,
          signer: wallet,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(redeemIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      showToast('success', `Redeemed ${redeemPercentNum}% of your vault shares for ZC`);
      setRedeemPercent("");

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchVaultData(), fetchZcBalance()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Redemption failed:", error);
      showToast('error', error instanceof Error ? error.message : "Failed to redeem shares");
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const formatCompactNumber = (num: number): string => {
    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(1)}B`;
    } else if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    showToast('success', 'Address copied to clipboard');
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  const handleConnectWallet = () => {
    try {
      if (!authenticated) {
        login();
      } else {
        linkWallet();
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      showToast('error', 'Failed to connect wallet. Please try again.');
    }
  };

  return (
    <div className="flex flex-col gap-[40px] items-center px-5 pt-[160px] w-full" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="flex flex-col gap-[24px] items-start w-full max-w-[576px]">
        {/* Info Text */}
        <div className="flex flex-col gap-[8px] items-start w-full">
          <p className="font-normal text-[14px] leading-[1.2]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
            Staking is deprecated until decision markets decide otherwise.
          </p>
          <p className="font-normal text-[14px] leading-[1.2]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
            Deposits and withdrawals are completely available.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="flex gap-[10px] items-start w-full">
          {/* ZC staked vaults stats */}
          <div 
            className="rounded-[12px] p-[16px] flex flex-col gap-[12px] items-start flex-1"
            style={{
              backgroundColor: theme === 'dark' ? '#222222' : '#fafafa',
              border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
            }}
          >
            <p className="font-normal text-[14px] leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
              ZC staked vaults stats
            </p>
            <div className="flex flex-col gap-[12px] items-start mt-[20px]">
              <p className="font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#5A5798' : '#403d6d' }}>
                {wallet ? `${calculateAPY().toFixed(0)}% APY Yield` : '0% APY Yield'}
              </p>
              <p className="font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
                {wallet ? `${formatCompactNumber(vaultBalance)} TVL` : '498.2M TVL'}
              </p>
            </div>
          </div>

          {/* Your staked ZC positions */}
          <div 
            className="rounded-[12px] p-[16px] flex flex-col gap-[12px] items-start flex-1"
            style={{
              backgroundColor: theme === 'dark' ? '#222222' : '#fafafa',
              border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
            }}
          >
            <p className="font-normal text-[14px] leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
              Your staked ZC positions
            </p>
            <div className="flex flex-col gap-[12px] items-start mt-[20px]">
              <p className="font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
                Held: {wallet ? `${zcBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '0.00'}
                {wallet && zcTotalSupply > 0 ? `(${((zcBalance / zcTotalSupply) * 100).toFixed(1)}%)` : '(0.0%)'}
              </p>
              <p className="font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
                Staked: {wallet ? `${userShareValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '104,259.98'}
                {wallet && zcTotalSupply > 0 ? `(${((userShareValue / zcTotalSupply) * 100).toFixed(3)}%)` : '(0.009%)'}
              </p>
            </div>
          </div>
        </div>

        {/* Stake/Redeem Section */}
        <div className="flex flex-col gap-[24px] items-start w-full">
          {/* Info Text */}
          <div className="flex flex-col gap-[8px] items-start w-full">
            <p className="font-normal text-[14px] leading-[1.2]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
              Stake your ZC and redeem your staked ZC below
            </p>
          </div>

          {/* Stake/Redeem Toggle and Exchange Rate */}
          <div className="flex flex-col gap-[12px] items-start w-full">
            <div className="flex items-center justify-between w-full">
              <div className="flex gap-[8px] items-center">
                <button
                  onClick={() => setModalMode("deposit")}
                  className="font-normal text-[14px] leading-[1.2] transition-colors cursor-pointer"
                  style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}
                >
                  Stake
                </button>
                <div
                  className="bg-[#403d6d] h-[22px] rounded-full w-[40px] relative transition-all cursor-pointer"
                  onClick={() => setModalMode(modalMode === "deposit" ? "redeem" : "deposit")}
                >
                  <div
                    className={`absolute bg-white rounded-full shadow-[0px_2px_4px_0px_rgba(39,39,39,0.1)] size-[18px] top-[2px] transition-all ${
                      modalMode === "deposit" ? "left-[2px]" : "left-[20px]"
                    }`}
                  />
                </div>
                <button
                  onClick={() => setModalMode("redeem")}
                  className="font-normal text-[14px] leading-[1.2] transition-colors cursor-pointer"
                  style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}
                >
                  Redeem
                </button>
              </div>
              <p className="font-normal text-[12px] leading-[1.6]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                Exchange Rate: 1 sZC : {wallet && exchangeRate > 0 ? exchangeRate.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 }) : '0.119350'} ZC
              </p>
            </div>

            {/* Stake/Redeem Form */}
            <div className="h-[87px] relative w-full">
              <div 
                className="absolute rounded-[12px] p-[16px] left-0 right-0 top-0"
                style={{
                  backgroundColor: theme === 'dark' ? '#222222' : '#fafafa',
                  border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
                }}
              >
                {modalMode === "deposit" ? (
                  <>
                    <div className="flex items-start justify-between mb-[8px]">
                      <p className="font-normal text-[14px] leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                        You stake
                      </p>
                      <div className="flex gap-[4px] items-center">
                        <p className="font-normal text-[14px] leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                          Balance:
                        </p>
                        <p className="font-normal text-[14px] leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                          {wallet ? `${zcBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ZC` : '0 ZC'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-[12px] items-center">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder="0.0"
                          value={amount}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === "" || /^\d*\.?\d*$/.test(value)) {
                              setAmount(value);
                            }
                          }}
                          className={`w-full bg-transparent text-[20px] font-medium leading-[1.34] tracking-[-0.2px] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-[60px] ${theme === 'dark' ? 'placeholder:text-[#B8B8B8]' : 'placeholder:text-[rgba(164,164,164,0.8)]'}`}
                          style={{ 
                            fontFamily: 'Inter, sans-serif',
                            color: theme === 'dark' ? '#ffffff' : '#0a0a0a',
                          }}
                          disabled={!wallet}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (zcBalance) {
                              setAmount(zcBalance.toString());
                            }
                          }}
                          className="absolute right-0 top-1/2 -translate-y-1/2 rounded-[4px] px-[8px] py-[4px] text-[12px] font-semibold leading-[16px] transition-colors cursor-pointer"
                          style={{
                            fontFamily: 'Inter, sans-serif',
                            backgroundColor: theme === 'dark' ? '#35343F' : '#ffffff',
                            border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
                            color: theme === 'dark' ? '#ffffff' : '#717182',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3F3E4F' : '#f6f6f7';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = theme === 'dark' ? '#35343F' : '#ffffff';
                          }}
                          tabIndex={-1}
                        >
                          MAX
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-[8px]">
                      <p className="font-normal text-[14px] leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                        You redeem
                      </p>
                      <div className="flex gap-[4px] items-center">
                        <p className="font-normal text-[14px] leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                          Balance:
                        </p>
                        <p className="font-normal text-[14px] leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                          {wallet ? `${userShareBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $sZC` : '104,259.98 $sZC'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-[12px] items-center">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder="0.0"
                          value={redeemPercent}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === "" || (/^\d*\.?\d*$/.test(value) && parseFloat(value) <= 100)) {
                              setRedeemPercent(value);
                            }
                          }}
                          className={`w-full bg-transparent text-[20px] font-medium leading-[1.34] tracking-[-0.2px] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-[60px] ${theme === 'dark' ? 'placeholder:text-[#B8B8B8]' : 'placeholder:text-[rgba(164,164,164,0.8)]'}`}
                          style={{ 
                            fontFamily: 'Inter, sans-serif',
                            color: theme === 'dark' ? '#ffffff' : '#0a0a0a',
                          }}
                          disabled={!withdrawalsEnabled || !wallet}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (userShareBalance > 0) {
                              setRedeemPercent('100');
                            }
                          }}
                          className="absolute right-0 top-1/2 -translate-y-1/2 rounded-[4px] px-[8px] py-[4px] text-[12px] font-semibold leading-[16px] transition-colors cursor-pointer"
                          style={{
                            fontFamily: 'Inter, sans-serif',
                            backgroundColor: theme === 'dark' ? '#35343F' : '#ffffff',
                            border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
                            color: theme === 'dark' ? '#ffffff' : '#717182',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3F3E4F' : '#f6f6f7';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = theme === 'dark' ? '#35343F' : '#ffffff';
                          }}
                          tabIndex={-1}
                        >
                          MAX
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Action Button */}
            <div className="flex items-center justify-center w-full mt-[20px]">
              {!wallet ? (
                <button
                  onClick={async () => {
                    try {
                      if (!authenticated) {
                        await login();
                      } else {
                        await linkWallet();
                      }
                    } catch (err) {
                      console.error('Failed to connect wallet:', err);
                    }
                  }}
                  disabled={loading}
                  className="w-[280px] rounded-[8px] px-4 py-3 transition-opacity disabled:cursor-not-allowed"
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    backgroundColor: theme === 'dark' ? '#404040' : '#f1f3f9',
                    color: theme === 'dark' ? '#ffffff' : '#0a0a0a',
                    opacity: loading && theme !== 'dark' ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = theme === 'dark' ? '#4A4A4A' : '#f1f3f9';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = theme === 'dark' ? '#404040' : '#f1f3f9';
                    }
                  }}
                >
                  <span className="font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize">
                    Connect A Wallet
                  </span>
                </button>
              ) : (
                <button
                  onClick={modalMode === "deposit" ? handleDeposit : handleRedeem}
                  className="w-[280px] rounded-[8px] px-4 py-3 transition-opacity disabled:cursor-not-allowed bg-[#403d6d] text-white hover:opacity-90 disabled:opacity-50"
                  style={{ fontFamily: 'Inter, sans-serif' }}
                  disabled={
                    loading ||
                    (modalMode === "deposit" ? (!amount || parseFloat(amount) <= 0) : (!redeemPercent || parseFloat(redeemPercent) <= 0 || !withdrawalsEnabled || userShareBalance === 0))
                  }
                >
                  <span className="font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize">
                    {loading ? "Processing..." : modalMode === "deposit" ? "Stake" : (!withdrawalsEnabled ? "Redemptions Disabled" : userShareBalance === 0 ? "No Shares to Redeem" : "Redeem")}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
