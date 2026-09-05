import React, { useState } from 'react';
import { Lock, CreditCard, Sparkles, X } from 'lucide-react';
import { logOut } from '../lib/firebase';
import { auth } from '../lib/firebase';
import { getApiBaseUrl } from '../utils/api';

interface PaywallModalProps {
  userId: string;
  onClose?: () => void;
}

export const PaywallModal: React.FC<PaywallModalProps> = ({ userId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubscribe = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const res = await fetch(`${getApiBaseUrl()}/api/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to initialize checkout');
      }
    } catch (error: any) {
      console.error('Failed to subscribe', error);
      setErrorMsg(error.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0c0d14] border border-[var(--accent-border)] rounded-2xl shadow-[0_0_50px_var(--accent-glow)] overflow-hidden flex flex-col p-8 text-center relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-white hover:bg-white/10 rounded-xl transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>
        )}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[var(--accent-color)] opacity-20 blur-[80px] rounded-full pointer-events-none" />
        <div className="w-16 h-16 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center mx-auto mb-6">
          <Lock className="w-8 h-8 text-[var(--accent-color)]" />
        </div>
        
        <h2 className="font-fantasy font-bold text-3xl text-white mb-2 tracking-wide">
          Unlock the Compendium
        </h2>
        <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
          Upgrade to Premium for 40 Pro queries a day (unused roll over up to 100!), and UNLIMITED high-speed Flash queries. Never lose your progress again.
        </p>

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-500 text-sm p-3 rounded-lg mb-4">
            {errorMsg}
          </div>
        )}

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-8 text-left">
          <div className="flex items-center justify-between mb-4">
            <span className="text-white font-semibold">Premium Access</span>
            <span className="text-[var(--accent-color)] font-bold text-xl">$4.99<span className="text-sm text-zinc-500 font-normal">/mo</span></span>
          </div>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-400" /> 40 Pro Queries/Day (Rolls over to 100)</li>
            <li className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-400" /> Unlimited Flash Fallback</li>
            <li className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-400" /> Cross-device Cloud Sync</li>
          </ul>
        </div>
        
        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-[var(--accent-color)] text-black font-bold py-3 px-6 rounded-xl hover:bg-white transition-colors disabled:opacity-50"
        >
          <CreditCard className="w-5 h-5" />
          {loading ? 'Connecting to Stripe...' : 'Subscribe via Stripe'}
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
