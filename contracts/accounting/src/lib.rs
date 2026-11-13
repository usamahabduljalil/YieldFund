//! Pure accounting foundation for the planned NEAR vault.
//! No chain interface, custody, token receiver or external valuation is implemented here.
//! The caller must establish asset provenance and settlement before using these functions.
use num_bigint::BigUint;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountingError {
    Overflow,
    ExclusionsExceedAssets,
    Unsettled,
    Impaired,
    InvalidUnits,
    MinimumNotMet,
    InsufficientSurplus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Snapshot {
    pub cash: u128,
    pub strategy: u128,
    pub in_transit: u128,
    pub excluded: u128,
    pub nominal: u128,
    pub pending: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Accounting {
    pub assets: u128,
    pub backing: u128,
    pub surplus: u128,
    pub shortfall: u128,
}

impl Snapshot {
    pub fn accounting(&self) -> Result<Accounting, AccountingError> {
        let gross = self
            .cash
            .checked_add(self.strategy)
            .and_then(|v| v.checked_add(self.in_transit))
            .ok_or(AccountingError::Overflow)?;
        let assets = gross
            .checked_sub(self.excluded)
            .ok_or(AccountingError::ExclusionsExceedAssets)?;
        Ok(Accounting {
            assets,
            backing: assets.min(self.nominal),
            surplus: assets.saturating_sub(self.nominal),
            shortfall: self.nominal.saturating_sub(assets),
        })
    }

    pub fn require_settled(&self) -> Result<(), AccountingError> {
        if self.pending || self.strategy != 0 || self.in_transit != 0 {
            return Err(AccountingError::Unsettled);
        }
        self.accounting()?;
        Ok(())
    }

    pub fn accept_deposit(&self, amount: u128) -> Result<Self, AccountingError> {
        self.require_settled()?;
        if amount == 0 {
            return Err(AccountingError::InvalidUnits);
        }
        if self.accounting()?.shortfall != 0 {
            return Err(AccountingError::Impaired);
        }
        Ok(Self {
            cash: self
                .cash
                .checked_add(amount)
                .ok_or(AccountingError::Overflow)?,
            nominal: self
                .nominal
                .checked_add(amount)
                .ok_or(AccountingError::Overflow)?,
            ..*self
        })
    }

    /// Wide multiplication avoids overflowing u128 before division.
    /// All remaining units receive all remaining supporter backing on final exit.
    pub fn redemption_quote(&self, units: u128) -> Result<u128, AccountingError> {
        if units == 0 || units > self.nominal {
            return Err(AccountingError::InvalidUnits);
        }
        let backing = self.accounting()?.backing;
        if units == self.nominal {
            return Ok(backing);
        }
        let result = (BigUint::from(units) * BigUint::from(backing)) / BigUint::from(self.nominal);
        u128::try_from(result).map_err(|_| AccountingError::Overflow)
    }

    /// Produces reserved effective state; caller must journal the original state for rollback.
    pub fn reserve_redemption(
        &self,
        units: u128,
        minimum: u128,
    ) -> Result<(Self, u128), AccountingError> {
        self.require_settled()?;
        let cash = self.redemption_quote(units)?;
        if cash < minimum {
            return Err(AccountingError::MinimumNotMet);
        }
        Ok((
            Self {
                cash: self
                    .cash
                    .checked_sub(cash)
                    .ok_or(AccountingError::Overflow)?,
                nominal: self.nominal - units,
                pending: true,
                ..*self
            },
            cash,
        ))
    }

    /// Proven eligible proceeds are a separate input from the candidate accounting surplus.
    /// A future on-chain caller must derive them internally, never trust a transaction argument.
    pub fn reserve_donation(
        &self,
        amount: u128,
        proven_eligible: u128,
    ) -> Result<Self, AccountingError> {
        self.require_settled()?;
        let a = self.accounting()?;
        if amount == 0 || amount > a.surplus || amount > proven_eligible {
            return Err(AccountingError::InsufficientSurplus);
        }
        Ok(Self {
            cash: self.cash - amount,
            pending: true,
            ..*self
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot(cash: u128, nominal: u128) -> Snapshot {
        Snapshot {
            cash,
            nominal,
            strategy: 0,
            in_transit: 0,
            excluded: 0,
            pending: false,
        }
    }
    #[test]
    fn positive_yield_preserves_capital() {
        let s = snapshot(1030, 1000);
        assert_eq!(
            s.accounting().unwrap(),
            Accounting {
                assets: 1030,
                backing: 1000,
                surplus: 30,
                shortfall: 0
            }
        );
        assert_eq!(s.reserve_donation(30, 30).unwrap().cash, 1000);
        assert_eq!(
            s.reserve_donation(31, 31),
            Err(AccountingError::InsufficientSurplus)
        );
        assert_eq!(
            s.reserve_donation(30, 0),
            Err(AccountingError::InsufficientSurplus)
        );
    }
    #[test]
    fn proportional_loss_and_recovery() {
        let s = snapshot(900, 1000);
        let (mut next, paid) = s.reserve_redemption(200, 180).unwrap();
        assert_eq!(paid, 180);
        assert_eq!((next.cash, next.nominal), (720, 800));
        assert_eq!(s.accept_deposit(10), Err(AccountingError::Impaired));
        assert_eq!(
            s.reserve_donation(1, 1),
            Err(AccountingError::InsufficientSurplus)
        );
        next.pending = false;
        next.cash = 810;
        assert_eq!(next.accounting().unwrap().surplus, 10);
    }
    #[test]
    fn estimates_are_not_liquid_settlements() {
        let mut s = snapshot(100, 1000);
        s.strategy = 930;
        assert_eq!(s.redemption_quote(200).unwrap(), 200);
        assert_eq!(
            s.reserve_redemption(200, 0),
            Err(AccountingError::Unsettled)
        );
        assert_eq!(s.reserve_donation(30, 30), Err(AccountingError::Unsettled));
        s.strategy = 0;
        s.in_transit = 930;
        assert_eq!(s.require_settled(), Err(AccountingError::Unsettled));
    }
    #[test]
    fn exclusions_and_minimums_are_enforced() {
        let mut s = snapshot(1500, 1000);
        s.excluded = 500;
        assert_eq!(s.accounting().unwrap().surplus, 0);
        assert_eq!(
            snapshot(900, 1000).reserve_redemption(200, 181),
            Err(AccountingError::MinimumNotMet)
        );
        assert_eq!(
            snapshot(0, 0).redemption_quote(0),
            Err(AccountingError::InvalidUnits)
        );
    }
    #[test]
    fn wide_intermediate_handles_maximum_values() {
        let s = snapshot(u128::MAX - 1, u128::MAX);
        assert_eq!(s.redemption_quote(u128::MAX - 1).unwrap(), u128::MAX - 2);
        assert_eq!(s.redemption_quote(u128::MAX).unwrap(), u128::MAX - 1);
        assert_eq!(
            snapshot(u128::MAX, u128::MAX).accept_deposit(1),
            Err(AccountingError::Overflow)
        );
    }
    #[test]
    fn last_exit_has_no_stranded_backing() {
        for original in 2..200u128 {
            let mut s = snapshot(original * 7 / 10, original);
            let mut total = 0;
            while s.nominal > 1 && s.cash > 1 {
                let units = (s.nominal / 2).max(1);
                if s.redemption_quote(units).unwrap() == 0 {
                    break;
                }
                let (next, paid) = s.reserve_redemption(units, 0).unwrap();
                total += paid;
                s = Snapshot {
                    pending: false,
                    ..next
                };
            }
            total += s.redemption_quote(s.nominal).unwrap();
            assert_eq!(total, original * 7 / 10);
        }
    }
}
