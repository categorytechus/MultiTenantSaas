'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAuthSession } from 'aws-amplify/auth';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState('Processing authentication...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check if user is authenticated
        const session = await fetchAuthSession();
        
        if (session.tokens) {
          setStatus('Authentication successful! Redirecting...');
          router.push('/dashboard');
        } else {
          setStatus('Authentication failed. Redirecting to sign in...');
          setTimeout(() => router.push('/auth/signin'), 2000);
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        setStatus('An error occurred. Redirecting to sign in...');
        setTimeout(() => router.push('/auth/signin'), 2000);
      }
    };

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-700">{status}</p>
      </div>
    </div>
  );
}