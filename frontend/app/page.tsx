'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAuthSession } from 'aws-amplify/auth';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const session = await fetchAuthSession();
        if (session.tokens) {
          router.push('/dashboard');
        }
      } catch (error) {
        // User not authenticated, stay on home page
      }
    };

    checkAuth();
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              MultiTenant SaaS Platform
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              AI-powered platform with intelligent agent orchestration
            </p>
            
            <div className="flex gap-4 justify-center">
              <Link
                href="/auth/signin"
                className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                className="px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold border-2 border-blue-600 hover:bg-blue-50 transition"
              >
                Sign Up
              </Link>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl">
            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="text-3xl mb-4">🤖</div>
              <h3 className="text-lg font-semibold mb-2">AI Agents</h3>
              <p className="text-gray-600 text-sm">
                Counselor, Enrollment, and Support agents powered by LangGraph, CrewAI, and Strands
              </p>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="text-3xl mb-4">🏢</div>
              <h3 className="text-lg font-semibold mb-2">Multi-Tenant</h3>
              <p className="text-gray-600 text-sm">
                Complete data isolation with row-level security and RBAC
              </p>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="text-3xl mb-4">⚡</div>
              <h3 className="text-lg font-semibold mb-2">Real-Time</h3>
              <p className="text-gray-600 text-sm">
                WebSocket-powered updates and asynchronous task processing
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}