'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, X, Sparkles } from 'lucide-react';

interface SearchBarProps {
  placeholder?: string;
  onSearch?: (query: string) => void;
  className?: string;
}

export function SearchBar({
  placeholder = 'Rechercher une destination...',
  onSearch,
  className = '',
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleClear = () => {
    setQuery('');
    onSearch?.('');
  };

  const handleChange = (value: string) => {
    setQuery(value);
    onSearch?.(value);
  };

  return (
    <motion.div
      className={`relative ${className}`}
      animate={{
        scale: isFocused ? 1.02 : 1,
      }}
      transition={{ duration: 0.2 }}
    >
      <div
        className={`
          flex items-center gap-3 px-4 py-3 rounded-xl
          bg-[#0d1f35]/80 backdrop-blur-xl
          border transition-all duration-300
          ${isFocused
            ? 'border-[#d4a853]/50 shadow-[0_0_20px_rgba(212,168,83,0.15)]'
            : 'border-[#1e3a5f]'
          }
        `}
      >
        <Search
          className={`w-5 h-5 transition-colors duration-300 ${
            isFocused ? 'text-[#d4a853]' : 'text-[#6b8aab]'
          }`}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-white placeholder-[#6b8aab] outline-none text-sm"
        />
        {query && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={handleClear}
            className="p-1 rounded-full hover:bg-[#d4a853]/10 transition-colors"
          >
            <X className="w-4 h-4 text-[#a8c0d8]" />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
