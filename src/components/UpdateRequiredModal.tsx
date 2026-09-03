import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { logOut } from '../lib/firebase';

export const UpdateRequiredModal: React.FC = () => {
  return (
    <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0c0d14] border border-red-500/30 rounded-2xl shadow-[0_0_50px_rgba(239,68,68,0.2)] overflow-hidden flex flex-col p-8 text-center relative">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-500 opacity-20 blur-[80px] rounded-full pointer-events-none" />
        
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        
        <h2 className="font-fantasy font-bold text-3xl text-white mb-2">
          Update Required
        </h2>
        <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
          This version of the application is no longer supported or the beta period has expired. Please download the latest version to continue using Quest Compendium.
        </p>
        
        <button
          onClick={() => window.open('https://github.com/QuestCompendium/releases', '_blank')}
          className="w-full flex items-center justify-center gap-2 bg-red-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-red-500 transition-colors"
        >
          Download Latest Version
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
