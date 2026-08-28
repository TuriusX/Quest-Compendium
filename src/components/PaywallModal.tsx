import React, { useState } from 'react';
import { Lock, CreditCard, Sparkles } from 'lucide-react';
import { logOut } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface PaywallModalProps {
  userId: string;
}

export const PaywallModal: React.FC<PaywallModalProps> = ({ userId }) => {
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    try {
      setLoading(true);
      // Simulate Stripe checkout success and activate subscription directly
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        subscriptionStatus: 'active',
        updatedAt: Date.now()
      });
    } catch (error) {
      console.error('Failed to subscribe', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0c0d14] border border-[var(--accent-border)] rounded-2xl shadow-[0_0_50px_var(--accent-glow)] overflow-hidden flex flex-col p-8 text-center relative">
        {/* Glow effect */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[var(--accent-color)] opacity-20 blur-[80px] rounded-full pointer-events-none" />

        <div className="w-16 h-16 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center mx-auto mb-6">
          <Lock className="w-8 h-8 text-[var(--accent-color)]" />
        </div>
        
        <h2 className="font-fantasy font-bold text-3xl text-white mb-2 tracking-wide">
          Unlock the Compendium
        </h2>
        <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
          Your account is currently locked. Subscribe to access the ultimate gaming companion, cross-device cloud syncing, and Bring Your Own Key (BYOK) AI integration.
        </p>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-8 text-left">
          <div className="flex items-center justify-between mb-4">
            <span className="text-white font-semibold">Monthly Access</span>
            <span className="text-[var(--accent-color)] font-bold text-xl">$1.99<span className="text-sm text-zinc-500 font-normal">/mo</span></span>
          </div>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-400" /> Bring Your Own Key (BYOK) Support</li>
            <li className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-400" /> Cross-device Cloud Sync</li>
            <li className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-400" /> Direct-to-API Secure Architecture</li>
          </ul>
        </div>

        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-[var(--accent-color)] text-black font-bold py-3 px-6 rounded-xl hover:bg-white transition-colors disabled:opacity-50"
        >
          <CreditCard className="w-5 h-5" />
          {loading ? 'Processing...' : 'Subscribe Now'}
        </button>

        <button
          onClick={logOut}
          className="mt-6 text-xs text-zinc-500 hover:text-white transition-colors underline"
        >
          Sign out
        </button>
      </div>
    </div>
  );
};
