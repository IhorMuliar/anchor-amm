import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorAmm } from "../target/types/anchor_amm";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("AMM Stress Tests", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.anchorAmm as Program<AnchorAmm>;
  const provider = anchor.getProvider();

  // Test accounts
  let trader: anchor.web3.Keypair;
  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;
  let traderTokenX: anchor.web3.PublicKey;
  let traderTokenY: anchor.web3.PublicKey;

  // Pool accounts
  let config: anchor.web3.PublicKey;
  let mintLp: anchor.web3.PublicKey;
  let vaultX: anchor.web3.PublicKey;
  let vaultY: anchor.web3.PublicKey;
  let traderLp: anchor.web3.PublicKey;

  const seed = new anchor.BN(999999);
  const fee = 100; // 1% fee

  before(async () => {
    // Create trader account
    trader = anchor.web3.Keypair.generate();

    // Airdrop SOL
    await provider.connection.requestAirdrop(trader.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create token mints
    mintX = await createMint(provider.connection, trader, trader.publicKey, null, 6);
    mintY = await createMint(provider.connection, trader, trader.publicKey, null, 6);

    // Create token accounts
    traderTokenX = await createAssociatedTokenAccount(provider.connection, trader, mintX, trader.publicKey);
    traderTokenY = await createAssociatedTokenAccount(provider.connection, trader, mintY, trader.publicKey);

    // Mint large amounts for stress testing
    await mintTo(provider.connection, trader, mintX, traderTokenX, trader, 1000000 * 1e6); // 1M tokens
    await mintTo(provider.connection, trader, mintY, traderTokenY, trader, 1000000 * 1e6); // 1M tokens

    // Derive pool accounts
    [config] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [mintLp] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), config.toBuffer()],
      program.programId
    );

    vaultX = await getAssociatedTokenAddress(mintX, config, true);
    vaultY = await getAssociatedTokenAddress(mintY, config, true);
    traderLp = await getAssociatedTokenAddress(mintLp, trader.publicKey);

    // Initialize pool
    await program.methods
      .initialize(seed, fee, null)
      .accounts({
        initUser: trader.publicKey,
        mintTokenX: mintX,
        mintTokenY: mintY,
        mintLpToken: mintLp,
        vaultTokenX: vaultX,
        vaultTokenY: vaultY,
        config: config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Add initial liquidity
    await program.methods
      .deposit(
        new anchor.BN(10000 * 1e6), // 10k LP tokens
        new anchor.BN(50000 * 1e6), // 50k X tokens
        new anchor.BN(100000 * 1e6)  // 100k Y tokens
      )
      .accounts({
        user: trader.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: config,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: traderTokenX,
        userY: traderTokenY,
        userLp: traderLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();
  });

  describe("High Volume Trading", () => {
    it("Handles multiple rapid swaps", async () => {
      const numSwaps = 10;
      const swapAmount = new anchor.BN(1000 * 1e6); // 1000 tokens each swap
      
      console.log(`Performing ${numSwaps} rapid swaps...`);

      for (let i = 0; i < numSwaps; i++) {
        const isXtoY = i % 2 === 0; // Alternate directions
        
        await program.methods
          .swap(isXtoY, swapAmount, new anchor.BN(1))
          .accounts({
            user: trader.publicKey,
            mintX: mintX,
            mintY: mintY,
            userX: traderTokenX,
            userY: traderTokenY,
            vaultX: vaultX,
            vaultY: vaultY,
            config: config,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([trader])
          .rpc();
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify pool still has reasonable balances
      const vaultXAccount = await getAccount(provider.connection, vaultX);
      const vaultYAccount = await getAccount(provider.connection, vaultY);
      
      assert.isTrue(Number(vaultXAccount.amount) > 0, "Pool should maintain X tokens");
      assert.isTrue(Number(vaultYAccount.amount) > 0, "Pool should maintain Y tokens");
      
      console.log(`Final pool balances: X=${Number(vaultXAccount.amount)/1e6}, Y=${Number(vaultYAccount.amount)/1e6}`);
    });

    it("Handles large single swap", async () => {
      const largeAmount = new anchor.BN(10000 * 1e6); // 10k tokens
      
      // Get balances before
      const vaultXBefore = await getAccount(provider.connection, vaultX);
      const vaultYBefore = await getAccount(provider.connection, vaultY);
      
      await program.methods
        .swap(true, largeAmount, new anchor.BN(1))
        .accounts({
          user: trader.publicKey,
          mintX: mintX,
          mintY: mintY,
          userX: traderTokenX,
          userY: traderTokenY,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      // Get balances after
      const vaultXAfter = await getAccount(provider.connection, vaultX);
      const vaultYAfter = await getAccount(provider.connection, vaultY);
      
      // Verify the swap occurred
      assert.isTrue(vaultXAfter.amount > vaultXBefore.amount, "Vault X should increase");
      assert.isTrue(vaultYAfter.amount < vaultYBefore.amount, "Vault Y should decrease");
      
      console.log(`Large swap impact: X +${Number(vaultXAfter.amount - vaultXBefore.amount)/1e6}, Y -${Number(vaultYBefore.amount - vaultYAfter.amount)/1e6}`);
    });
  });

  describe("Liquidity Management Stress", () => {
    it("Handles multiple liquidity providers", async () => {
      // Create multiple users
      const users = [];
      for (let i = 0; i < 3; i++) {
        const user = anchor.web3.Keypair.generate();
        await provider.connection.requestAirdrop(user.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const userTokenX = await createAssociatedTokenAccount(provider.connection, user, mintX, user.publicKey);
        const userTokenY = await createAssociatedTokenAccount(provider.connection, user, mintY, user.publicKey);
        const userLp = await getAssociatedTokenAddress(mintLp, user.publicKey);
        
        // Mint tokens to user
        await mintTo(provider.connection, trader, mintX, userTokenX, trader, 100000 * 1e6);
        await mintTo(provider.connection, trader, mintY, userTokenY, trader, 100000 * 1e6);
        
        users.push({ keypair: user, tokenX: userTokenX, tokenY: userTokenY, lp: userLp });
      }

      // Each user adds liquidity
      for (const user of users) {
        await program.methods
          .deposit(
            new anchor.BN(1000 * 1e6), // 1k LP tokens
            new anchor.BN(10000 * 1e6), // 10k X tokens max
            new anchor.BN(20000 * 1e6)  // 20k Y tokens max
          )
          .accounts({
            user: user.keypair.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: user.tokenX,
            userY: user.tokenY,
            userLp: user.lp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user.keypair])
          .rpc();
        
        // Verify user received LP tokens
        const userLpAccount = await getAccount(provider.connection, user.lp);
        assert.equal(userLpAccount.amount.toString(), (1000 * 1e6).toString());
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log("Successfully added liquidity from multiple providers");
    });

    it("Handles rapid deposit/withdraw cycles", async () => {
      const cycles = 5;
      const depositAmount = new anchor.BN(500 * 1e6);
      
      for (let i = 0; i < cycles; i++) {
        // Deposit
        await program.methods
          .deposit(depositAmount, new anchor.BN(5000 * 1e6), new anchor.BN(10000 * 1e6))
          .accounts({
            user: trader.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: traderTokenX,
            userY: traderTokenY,
            userLp: traderLp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([trader])
          .rpc();

        await new Promise(resolve => setTimeout(resolve, 200));

        // Withdraw
        await program.methods
          .withdraw(depositAmount, new anchor.BN(1), new anchor.BN(1))
          .accounts({
            user: trader.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: traderTokenX,
            userY: traderTokenY,
            userLp: traderLp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([trader])
          .rpc();

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log(`Completed ${cycles} deposit/withdraw cycles`);
    });
  });

  describe("Pool State Verification", () => {
    it("Maintains mathematical invariants", async () => {
      const vaultXAccount = await getAccount(provider.connection, vaultX);
      const vaultYAccount = await getAccount(provider.connection, vaultY);
      const mintLpAccount = await getAccount(provider.connection, mintLp);
      
      const x = Number(vaultXAccount.amount);
      const y = Number(vaultYAccount.amount);
      const lpSupply = Number(mintLpAccount.amount);
      
      // Basic invariants
      assert.isTrue(x > 0, "Pool must have X tokens");
      assert.isTrue(y > 0, "Pool must have Y tokens");
      assert.isTrue(lpSupply > 0, "LP supply must be positive");
      
      // Calculate constant product
      const k = x * y;
      console.log(`Pool invariant k = ${k.toExponential(2)}`);
      console.log(`Pool state: X=${x/1e6}, Y=${y/1e6}, LP=${lpSupply/1e6}`);
      
      // Verify reasonable ratios
      const ratio = x / y;
      assert.isTrue(ratio > 0.1 && ratio < 10, "Pool ratio should be reasonable");
    });

    it("Pool configuration is intact", async () => {
      const poolConfig = await program.account.config.fetch(config);
      
      assert.equal(poolConfig.seed.toString(), seed.toString());
      assert.equal(poolConfig.fee, fee);
      assert.equal(poolConfig.mintX.toString(), mintX.toString());
      assert.equal(poolConfig.mintY.toString(), mintY.toString());
      assert.equal(poolConfig.locked, false);
      
      console.log("Pool configuration verified intact");
    });
  });
});