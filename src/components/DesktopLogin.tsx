import React, { useEffect, useState } from 'react';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { Gamepad2 } from 'lucide-react';

export const DesktopLogin: React.FC = () => {
  const [status, setStatus] = useState('Waiting for you to log in...');
  const [error, setError] = useState('');

  useEffect(() => {
    const performLogin = async () => {
      try {
        setStatus('Opening Google Login...');
        const result = await signInWithPopup(auth, googleProvider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential && credential.idToken) {
          setStatus('Login successful! Redirecting back to the app...');
          // Redirect back to the Electron app
          window.location.href = `questcompendium://auth?idToken=${credential.idToken}`;
          
          // Close this window after a delay
          setTimeout(() => {
            window.close();
            setStatus('You can close this tab now.');
          }, 2000);
        } else {
          setError('Failed to get credentials from Google.');
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'An error occurred during login.');
      }
    };

    performLogin();
  }, []);

  return (
    <div className="w-screen h-screen bg-[#070709] flex flex-col items-center justify-center p-4 text-white">
      <div className="w-16 h-16 rounded-2xl bg-[#a87ffb]/15 border border-[#a87ffb]/30 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(168,127,251,0.4)]">
        <Gamepad2 className="w-8 h-8 text-[#a87ffb]" />
      </div>
      <h1 className="text-2xl font-bold mb-4">Quest Compendium Auth</h1>
      {error ? (
        <div className="text-red-400 bg-red-400/10 p-4 rounded-lg max-w-md text-center">
          {error}
        </div>
      ) : (
        <div className="text-zinc-400 flex flex-col items-center gap-4">
          <div className="w-6 h-6 border-2 border-[#a87ffb] border-t-transparent rounded-full animate-spin"></div>
          {status}
        </div>
      )}
    </div>
  );
};
