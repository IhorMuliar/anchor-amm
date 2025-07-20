use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::state::Config;

/// Accounts needed to create a new pool
#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub init_user: Signer<'info>,              // Person creating the pool
    pub mint_token_x: Account<'info, Mint>,    // First token to trade
    pub mint_token_y: Account<'info, Mint>,    // Second token to trade

    #[account(
        init,
        payer = init_user,
        seeds = [b"lp", config.key.as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = config,
    )]
    pub mint_lp_token: Account<'info, Mint>,   // LP tokens for liquidity providers

    #[account(
        init,
        payer = init_user,
        associated_token::mint = mint_token_x,
        associated_token::authority = config,
    )]
    pub vault_token_x: Account<'info, TokenAccount>, // Pool's X token storage

    #[account(
        init,
        payer = init_user,
        associated_token::mint = mint_token_y,
        associated_token::authority = config,
    )]
    pub vault_token_y: Account<'info, TokenAccount>, // Pool's Y token storage

    #[account(
        init,
        payer = init_user,
        seeds = [b"config", seed.to_le_bytes().as_ref()],
        bump,
        space = Config::INIT_SPACE,
    )]
    pub config: Account<'info, Config>,        // Pool settings and state

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    /// Create and configure the new pool
    pub fn init(
        &mut self,
        seed: u64,
        fee: u16,
        authority: Option<Pubkey>,
        bumps: InitializeBumps,
    ) -> Result<()> {
        // Save pool configuration
        self.config.set_inner(Config {
            seed,
            authority,
            mint_x: self.mint_token_x.key(),
            mint_y: self.mint_token_y.key(),
            fee,
            locked: false, // Start unlocked
            config_bump: bumps.config,
            lp_bump: bumps.mint_lp_token,
        });

        Ok(())
    }
}
