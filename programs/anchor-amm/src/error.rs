use anchor_lang::prelude::*;

/// Custom errors for the AMM program
#[error_code]
pub enum AmmError {
    #[msg("Pool is locked for operations")]
    PoolLocked, // Pool temporarily disabled
    #[msg("Invalid amount provided")]
    InvalidAmount, // Zero or negative amounts
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded, // Price moved too much
    #[msg("Curve calculation error")]
    CurveError, // Math library error
}

// Convert curve library errors to our errors
impl From<constant_product_curve::CurveError> for AmmError {
    fn from(_: constant_product_curve::CurveError) -> Self {
        AmmError::CurveError
    }
}
