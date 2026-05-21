'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import CompanionDrawer, { CMsg } from './CompanionDrawer';
import PricingModal from './PricingModal';

export default function GlobalCompanionBubble() {
  const [showCompanion, setShowCompanion] = useState(false);
  const [isCompanionGenerating, setIsCompanionGenerating] = useState(false);
  const [companionMessages, setCompanionMessages] = useState<CMsg[]>([]);
  const [authToken, setAuthToken] = useState('');
  const [isPro, setIsPro] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthToken(session?.access_token ?? '');
    });
    try {
      setIsPro(localStorage.getItem('based_sub_tier') === 'pro');
    } catch {}
  }, []);

  const getHeaders = async (): Promise<HeadersInit> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      'Content-Type': 'application/json',
    };
  };

  return (
    <>
      <button
        className={`companion-trigger${showCompanion ? ' companion-trigger--open' : ''}${isCompanionGenerating ? ' companion-trigger--responding' : ''}`}
        onClick={() => {
          if (!showCompanion && !isPro) {
            setShowPricing(true);
            return;
          }
          setShowCompanion(s => !s);
        }}
        aria-label="Open AI Companion"
      >
        <span className="companion-trigger-label">B</span>
        <span className="companion-trigger-ring companion-trigger-ring--1" />
        <span className="companion-trigger-ring companion-trigger-ring--2" />
      </button>

      <AnimatePresence>
        {showCompanion && (
          <CompanionDrawer
            memory=""
            files={[]}
            initialMessages={companionMessages}
            onMessagesChange={setCompanionMessages}
            onClose={() => setShowCompanion(false)}
            onGeneratingChange={setIsCompanionGenerating}
            authToken={authToken}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPricing && (
          <PricingModal
            reason="companion"
            onClose={() => setShowPricing(false)}
            getHeaders={getHeaders}
          />
        )}
      </AnimatePresence>
    </>
  );
}
