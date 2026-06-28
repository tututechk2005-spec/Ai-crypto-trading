const db = require('./db');

const REFERRAL_COMMISSION_PERCENT = 5; // 5% of subscription fee

// ── Get referral dashboard for a user ────────────────────────────────────────
function getReferralDashboard(userId) {
  const user = db.getUserById(userId);
  if (!user) return null;
  const allUsers = db.getUsers();
  const referrals = allUsers.filter(u => u.referredBy === userId);
  const premiumReferrals = referrals.filter(u => u.isPremium);

  return {
    referralCode: user.referralCode,
    referralLink: `/register?ref=${user.referralCode}`,
    totalReferrals: referrals.length,
    premiumReferrals: premiumReferrals.length,
    totalEarnings: user.referralEarnings || 0,
    referrals: referrals.map(u => ({
      id: u.id,
      username: u.username,
      joinedAt: u.createdAt,
      isPremium: u.isPremium,
      subscriptionPlan: u.subscriptionPlan,
    })),
  };
}

// ── Credit referrer when someone subscribes ───────────────────────────────────
function creditReferrer(newUserId, subscriptionAmount) {
  const user = db.getUserById(newUserId);
  if (!user || !user.referredBy) return;

  const commission = subscriptionAmount * (REFERRAL_COMMISSION_PERCENT / 100);
  db.updateUser(user.referredBy, referrer => {
    referrer.referralEarnings = (referrer.referralEarnings || 0) + commission;
  });

  db.addLog({
    type: 'referral',
    message: `Referral commission $${commission.toFixed(2)} credited to user ${user.referredBy}`,
    userId: user.referredBy,
    refUserId: newUserId,
  });
}

module.exports = { getReferralDashboard, creditReferrer, REFERRAL_COMMISSION_PERCENT };
