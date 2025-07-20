use anchor_lang::prelude::*;

/// Pool configuration and state
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Option<Pubkey>, // Who can update settings
    pub seed: u64,                 // Random seed for this pool
    pub fee: u16,                  // Trading fee in basis points
    pub mint_x: Pubkey,            // First token mint
    pub mint_y: Pubkey,            // Second token mint
    pub locked: bool,              // Emergency pause switch
    pub config_bump: u8,           // PDA bump for config account
    pub lp_bump: u8,               // PDA bump for LP mint
}
