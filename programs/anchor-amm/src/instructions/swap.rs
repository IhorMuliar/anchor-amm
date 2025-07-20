use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer, Mint, Token, TokenAccount, Transfer},
};
use constant_product_curve::{ConstantProduct, LiquidityPair};

use crate::{error::AmmError, state::Config};

/// Accounts needed to swap tokens
#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,           // Person doing the swap
    pub mint_x: Account<'info, Mint>,  // First token type
    pub mint_y: Account<'info, Mint>,  // Second token type

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_x,
        associated_token::authority = user,
    )]
    pub user_x: Account<'info, TokenAccount>, // User's X tokens

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_y,
        associated_token::authority = user,
    )]
    pub user_y: Account<'info, TokenAccount>, // User's Y tokens

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = config,
    )]
    pub vault_x: Account<'info, TokenAccount>, // Pool's X tokens

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = config,
    )]
    pub vault_y: Account<'info, TokenAccount>, // Pool's Y tokens

    #[account(
        has_one = mint_x,
        has_one = mint_y,
        seeds = [b"config", config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump,
    )]
    pub config: Account<'info, Config>,       // Pool settings

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Swap<'info> {
    /// Trade one token for another
    pub fn swap(&mut self, is_x: bool, amount: u64, min: u64) -> Result<()> {
        // Safety checks
        require!(self.config.locked == false, AmmError::PoolLocked);
        require!(amount > 0, AmmError::InvalidAmount);

        // Set up the AMM curve calculation
        let mut curve = ConstantProduct::init(
            self.vault_x.amount,
            self.vault_y.amount,
            self.vault_x.amount,
            self.config.fee,
            None,
        )
        .map_err(AmmError::from)?;

        // Choose which token we're trading
        let p = match is_x {
            true => LiquidityPair::X,  // Trading X for Y
            false => LiquidityPair::Y, // Trading Y for X
        };

        // Calculate the swap amounts
        let res = curve.swap(p, amount, min).map_err(AmmError::from)?;

        // Make sure we got valid amounts
        require!(res.deposit != 0, AmmError::InvalidAmount);
        require!(res.withdraw != 0, AmmError::InvalidAmount);

        // Deposit tokens
        self.deposit_tokens(is_x, res.deposit)?;
        // Withdraw tokens
        self.withdraw_tokens(is_x, res.withdraw)?;

        Ok(())
    }

    /// Take tokens from user and put in pool
    pub fn deposit_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (from, to) = match is_x {
            true => (
                self.user_x.to_account_info(),
                self.vault_x.to_account_info(),
            ),
            false => (
                self.user_y.to_account_info(),
                self.vault_y.to_account_info(),
            ),
        };

        let cpi_program = self.token_program.to_account_info();

        let accounts = Transfer {
            from: from.to_account_info(),
            to: to.to_account_info(),
            authority: self.user.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, accounts);

        transfer(cpi_ctx, amount)?;

        Ok(())
    }

    /// Take tokens from pool and give to user
    pub fn withdraw_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        // Swap direction: give opposite token
        let (from, to) = match is_x {
            true => (
                self.vault_y.to_account_info(), // Give Y tokens
                self.user_y.to_account_info(),
            ),
            false => (
                self.vault_x.to_account_info(), // Give X tokens
                self.user_x.to_account_info(),
            ),
        };

        let cpi_program = self.token_program.to_account_info();

        let accounts = Transfer {
            from: from.to_account_info(),
            to: to.to_account_info(),
            authority: self.config.to_account_info(),
        };

        // Sign as pool authority to send tokens
        let seeds = &[
            &b"config"[..],
            &self.config.seed.to_le_bytes(),
            &[self.config.config_bump],
        ];

        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(cpi_program, accounts, signer_seeds);

        transfer(cpi_ctx, amount)?;

        Ok(())
    }
}
