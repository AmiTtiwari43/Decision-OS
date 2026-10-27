import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { sound } from '../utils/audioFx';

export const ScrollToTop: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show when scrolled down more than 600px or when reaching near bottom
      const scrolled = window.scrollY > 600;
      setIsVisible(scrolled);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleScrollToTop = () => {
    sound.playTick(900);
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          onClick={handleScrollToTop}
          className="fixed bottom-6 right-6 z-40 p-3.5 rounded-2xl bg-surface-card/90 hover:bg-surface border border-signal/40 hover:border-signal text-signal hover:text-white backdrop-blur-md shadow-glow-signal-sm hover:shadow-glow-signal transition-all duration-300 group flex items-center gap-2 cursor-pointer"
          title="Scroll back to start / top of page"
          aria-label="Scroll back to top of page"
        >
          <ArrowUp className="w-5 h-5 group-hover:-translate-y-1 transition-transform duration-200" />
          <span className="text-xs font-mono font-semibold hidden sm:inline pr-1">
            Back to Top
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
};
