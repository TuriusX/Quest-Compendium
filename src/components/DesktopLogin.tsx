import React, { useEffect, useState, useRef } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { LogIn } from 'lucide-react';
import { MagicalBookIcon } from './MagicalBookIcon';

export const DesktopLogin: React.FC = () => {
  const [status, setStatus] = useState('Ready to login');
  const [error, setError] = useState('');
  const initialized = useRef(false);

  const handleLogin = async () => {
    try {
      setStatus('Opening Google Login...');
      setError('');
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      
      if (credential && credential.idToken) {
        setStatus('Login successful! Sending you back to the app...');
        
        // Post the token securely to the local Electron server
        const urlParams = new URLSearchParams(window.location.search);
        const port = urlParams.get('port');
        
        if (port) {
          try {
            await fetch(`http://127.0.0.1:${port}/auth-callback`, {
              method: 'POST',
              body: JSON.stringify({ idToken: credential.idToken })
            });
          } catch(e) {
            console.error("Failed to post to Electron server", e);
          }
        }
        
        setTimeout(() => {
          window.close();
          setStatus('You can safely close this window.');
        }, 1500);
      } else {
        setError('Failed to extract Google credentials.');
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/popup-closed-by-user') {
         setError('Login was cancelled. Please try again.');
      } else {
         setError(err.message || 'An error occurred. Please try again.');
      }
      setStatus('Ready to login');
    }
  };

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      handleLogin();
    }
  }, []);

  return (
    <div className="w-screen h-screen bg-[#070709] flex flex-col items-center justify-center p-4 text-white font-sans">
      <MagicalBookIcon className="w-16 h-16 mb-6 shadow-[0_0_40px_rgba(168,127,251,0.4)] rounded-2xl" />
      <h1 className="text-2xl font-bold mb-2">Quest Compendium</h1>
      <p className="text-zinc-400 mb-8 text-center max-w-sm">
        Please sign in securely with your Google account to connect your desktop app.
      </p>
      
      {error ? (
        <div className="text-red-400 bg-red-400/10 p-4 rounded-lg max-w-md text-center mb-6 border border-red-400/20">
          {error}
        </div>
      ) : null}

      <div className="text-zinc-400 flex flex-col items-center gap-4 mb-8 h-12">
        {status === 'Opening Google Login...' || status === 'Login successful! Sending you back to the app...' ? (
           <div className="w-6 h-6 border-2 border-[#a87ffb] border-t-transparent rounded-full animate-spin"></div>
        ) : null}
        <p>{status}</p>
      </div>

      <button 
        onClick={handleLogin}
        className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-full font-semibold hover:bg-zinc-200 transition-colors shadow-lg"
      >
        <LogIn className="w-5 h-5" />
        Sign in with Google
      </button>
    </div>
  );
};
