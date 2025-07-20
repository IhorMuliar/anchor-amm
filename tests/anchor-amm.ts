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
import { assert, expect } from "chai";

describe("anchor-amm", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.anchorAmm as Program<AnchorAmm>;
  const provider = anchor.getProvider();

  // Test accounts
  let user1: anchor.web3.Keypair;
  let user2: anchor.web3.Keypair;
  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;
  let user1TokenX: anchor.web3.PublicKey;
  let user1TokenY: anchor.web3.PublicKey;
  let user2TokenX: anchor.web3.PublicKey;
  let user2TokenY: anchor.web3.PublicKey;

  // Pool accounts
  let config: anchor.web3.PublicKey;
  let mintLp: anchor.web3.PublicKey;
  let vaultX: anchor.web3.PublicKey;
  let vaultY: anchor.web3.PublicKey;
  let user1Lp: anchor.web3.PublicKey;
  let user2Lp: anchor.web3.PublicKey;

  const seed = new anchor.BN(123456);
  const fee = 300; // 3% fee (300 basis points)

  before(async () => {
    // Create user accounts
    user1 = anchor.web3.Keypair.generate();
    user2 = anchor.web3.Keypair.generate();

    // Airdrop SOL to users
    await provider.connection.requestAirdrop(user1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(user2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create token mints
    mintX = await createMint(
      provider.connection,
      user1,
      user1.publicKey,
      null,
      9
    );

    mintY = await createMint(
      provider.connection,
      user1,
      user1.publicKey,
      null,
      9
    );

    // Create user token accounts
    user1TokenX = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      mintX,
      user1.publicKey
    );

    user1TokenY = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      mintY,
      user1.publicKey
    );

    user2TokenX = await createAssociatedTokenAccount(
      provider.connection,
      user2,
      mintX,
      user2.publicKey
    );

    user2TokenY = await createAssociatedTokenAccount(
      provider.connection,
      user2,
      mintY,
      user2.publicKey
    );

    // Mint tokens to users
    await mintTo(
      provider.connection,
      user1,
      mintX,
      user1TokenX,
      user1,
      1000 * 1e9 // 1000 tokens
    );

    await mintTo(
      provider.connection,
      user1,
      mintY,
      user1TokenY,
      user1,
      1000 * 1e9 // 1000 tokens
    );

    await mintTo(
      provider.connection,
      user1,
      mintX,
      user2TokenX,
      user1,
      500 * 1e9 // 500 tokens
    );

    await mintTo(
      provider.connection,
      user1,
      mintY,
      user2TokenY,
      user1,
      500 * 1e9 // 500 tokens
    );

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
    user1Lp = await getAssociatedTokenAddress(mintLp, user1.publicKey);
    user2Lp = await getAssociatedTokenAddress(mintLp, user2.publicKey);
  });

  describe("Initialize Pool", () => {
    it("Creates a new AMM pool successfully", async () => {
      const tx = await program.methods
        .initialize(seed, fee, null)
        .accounts({
          initUser: user1.publicKey,
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
        .signers([user1])
        .rpc();

      console.log("Initialize transaction signature:", tx);

      // Verify pool configuration
      const poolConfig = await program.account.config.fetch(config);
      assert.equal(poolConfig.seed.toString(), seed.toString());
      assert.equal(poolConfig.fee, fee);
      assert.equal(poolConfig.mintX.toString(), mintX.toString());
      assert.equal(poolConfig.mintY.toString(), mintY.toString());
      assert.equal(poolConfig.locked, false);
      assert.equal(poolConfig.authority, null);
    });

    it("Fails to initialize with duplicate seed", async () => {
      try {
        await program.methods
          .initialize(seed, fee, null)
          .accounts({
            initUser: user1.publicKey,
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
          .signers([user1])
          .rpc();
        
        assert.fail("Should have failed with duplicate seed");
      } catch (error) {
        assert.include(error.message, "already in use");
      }
    });
  });

  describe("Add Liquidity", () => {
    it("Adds initial liquidity to empty pool", async () => {
      const amountLp = new anchor.BN(100 * 1e6); // 100 LP tokens
      const maxX = new anchor.BN(100 * 1e9); // 100 X tokens
      const maxY = new anchor.BN(200 * 1e9); // 200 Y tokens

      const tx = await program.methods
        .deposit(amountLp, maxX, maxY)
        .accounts({
          user: user1.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: user1TokenX,
          userY: user1TokenY,
          userLp: user1Lp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log("First deposit transaction signature:", tx);

      // Check vault balances
      const vaultXAccount = await getAccount(provider.connection, vaultX);
      const vaultYAccount = await getAccount(provider.connection, vaultY);
      
      assert.equal(vaultXAccount.amount.toString(), maxX.toString());
      assert.equal(vaultYAccount.amount.toString(), maxY.toString());

      // Check user LP tokens
      const user1LpAccount = await getAccount(provider.connection, user1Lp);
      assert.equal(user1LpAccount.amount.toString(), amountLp.toString());
    });

    it("Adds proportional liquidity to existing pool", async () => {
      const amountLp = new anchor.BN(50 * 1e6); // 50 LP tokens
      const maxX = new anchor.BN(100 * 1e9); // Max 100 X tokens
      const maxY = new anchor.BN(200 * 1e9); // Max 200 Y tokens

      const tx = await program.methods
        .deposit(amountLp, maxX, maxY)
        .accounts({
          user: user2.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: user2TokenX,
          userY: user2TokenY,
          userLp: user2Lp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      console.log("Second deposit transaction signature:", tx);

      // Check user LP tokens
      const user2LpAccount = await getAccount(provider.connection, user2Lp);
      assert.equal(user2LpAccount.amount.toString(), amountLp.toString());
    });

    it("Fails deposit with zero amount", async () => {
      try {
        await program.methods
          .deposit(new anchor.BN(0), new anchor.BN(100), new anchor.BN(100))
          .accounts({
            user: user1.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: user1TokenX,
            userY: user1TokenY,
            userLp: user1Lp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        
        assert.fail("Should have failed with zero amount");
      } catch (error) {
        assert.include(error.message, "InvalidAmount");
      }
    });
  });

  describe("Token Swaps", () => {
    it("Swaps X tokens for Y tokens", async () => {
      const amountIn = new anchor.BN(10 * 1e9); // 10 X tokens
      const minAmountOut = new anchor.BN(1 * 1e9); // Minimum 1 Y token

      // Get balances before swap
      const user1XBefore = await getAccount(provider.connection, user1TokenX);
      const user1YBefore = await getAccount(provider.connection, user1TokenY);

      const tx = await program.methods
        .swap(true, amountIn, minAmountOut) // true = swapping X for Y
        .accounts({
          user: user1.publicKey,
          mintX: mintX,
          mintY: mintY,
          userX: user1TokenX,
          userY: user1TokenY,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      console.log("Swap X->Y transaction signature:", tx);

      // Get balances after swap
      const user1XAfter = await getAccount(provider.connection, user1TokenX);
      const user1YAfter = await getAccount(provider.connection, user1TokenY);

      // Verify X tokens decreased
      assert.isTrue(user1XAfter.amount < user1XBefore.amount);
      // Verify Y tokens increased
      assert.isTrue(user1YAfter.amount > user1YBefore.amount);
    });

    it("Swaps Y tokens for X tokens", async () => {
      const amountIn = new anchor.BN(15 * 1e9); // 15 Y tokens
      const minAmountOut = new anchor.BN(1 * 1e9); // Minimum 1 X token

      // Get balances before swap
      const user2XBefore = await getAccount(provider.connection, user2TokenX);
      const user2YBefore = await getAccount(provider.connection, user2TokenY);

      const tx = await program.methods
        .swap(false, amountIn, minAmountOut) // false = swapping Y for X
        .accounts({
          user: user2.publicKey,
          mintX: mintX,
          mintY: mintY,
          userX: user2TokenX,
          userY: user2TokenY,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      console.log("Swap Y->X transaction signature:", tx);

      // Get balances after swap
      const user2XAfter = await getAccount(provider.connection, user2TokenX);
      const user2YAfter = await getAccount(provider.connection, user2TokenY);

      // Verify Y tokens decreased
      assert.isTrue(user2YAfter.amount < user2YBefore.amount);
      // Verify X tokens increased
      assert.isTrue(user2XAfter.amount > user2XBefore.amount);
    });

    it("Fails swap with zero amount", async () => {
      try {
        await program.methods
          .swap(true, new anchor.BN(0), new anchor.BN(1))
          .accounts({
            user: user1.publicKey,
            mintX: mintX,
            mintY: mintY,
            userX: user1TokenX,
            userY: user1TokenY,
            vaultX: vaultX,
            vaultY: vaultY,
            config: config,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        
        assert.fail("Should have failed with zero amount");
      } catch (error) {
        assert.include(error.message, "InvalidAmount");
      }
    });
  });

  describe("Remove Liquidity", () => {
    it("Withdraws liquidity proportionally", async () => {
      const lpAmount = new anchor.BN(25 * 1e6); // 25 LP tokens
      const minX = new anchor.BN(1); // Minimum 1 wei
      const minY = new anchor.BN(1); // Minimum 1 wei

      // Get balances before withdrawal
      const user1LpBefore = await getAccount(provider.connection, user1Lp);
      const user1XBefore = await getAccount(provider.connection, user1TokenX);
      const user1YBefore = await getAccount(provider.connection, user1TokenY);

      const tx = await program.methods
        .withdraw(lpAmount, minX, minY)
        .accounts({
          user: user1.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: user1TokenX,
          userY: user1TokenY,
          userLp: user1Lp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log("Withdraw transaction signature:", tx);

      // Get balances after withdrawal
      const user1LpAfter = await getAccount(provider.connection, user1Lp);
      const user1XAfter = await getAccount(provider.connection, user1TokenX);
      const user1YAfter = await getAccount(provider.connection, user1TokenY);

      // Verify LP tokens decreased
      assert.isTrue(user1LpAfter.amount < user1LpBefore.amount);
      // Verify underlying tokens increased
      assert.isTrue(user1XAfter.amount > user1XBefore.amount);
      assert.isTrue(user1YAfter.amount > user1YBefore.amount);
    });

    it("Fails withdrawal with zero amount", async () => {
      try {
        await program.methods
          .withdraw(new anchor.BN(0), new anchor.BN(1), new anchor.BN(1))
          .accounts({
            user: user1.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: user1TokenX,
            userY: user1TokenY,
            userLp: user1Lp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        
        assert.fail("Should have failed with zero amount");
      } catch (error) {
        assert.include(error.message, "InvalidAmount");
      }
    });

    it("Fails withdrawal with zero min amounts", async () => {
      try {
        await program.methods
          .withdraw(new anchor.BN(10), new anchor.BN(0), new anchor.BN(0))
          .accounts({
            user: user1.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: user1TokenX,
            userY: user1TokenY,
            userLp: user1Lp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        
        assert.fail("Should have failed with zero min amounts");
      } catch (error) {
        assert.include(error.message, "InvalidAmount");
      }
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("Maintains correct pool ratios after multiple operations", async () => {
      // Get current pool state
      const vaultXAccount = await getAccount(provider.connection, vaultX);
      const vaultYAccount = await getAccount(provider.connection, vaultY);
      
      const ratioX = Number(vaultXAccount.amount);
      const ratioY = Number(vaultYAccount.amount);
      const currentRatio = ratioX / ratioY;

      console.log(`Current pool ratio X:Y = ${currentRatio.toFixed(4)}`);
      console.log(`Pool balances: X=${ratioX/1e9}, Y=${ratioY/1e9}`);

      // Verify pool has reasonable balances
      assert.isTrue(ratioX > 0, "Pool should have X tokens");
      assert.isTrue(ratioY > 0, "Pool should have Y tokens");
    });

    it("Pool configuration remains consistent", async () => {
      const poolConfig = await program.account.config.fetch(config);
      
      assert.equal(poolConfig.seed.toString(), seed.toString());
      assert.equal(poolConfig.fee, fee);
      assert.equal(poolConfig.mintX.toString(), mintX.toString());
      assert.equal(poolConfig.mintY.toString(), mintY.toString());
      assert.equal(poolConfig.locked, false);
    });
  });
});