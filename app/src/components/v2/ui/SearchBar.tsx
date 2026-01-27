'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';

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
          bg-[#12121a]/60 backdrop-blur-xl
          border transition-colors duration-200
          ${isFocused ? 'border-indigo-500/50' : 'border-[#2a2a38]'}
        `}
      >
        <Search className={`w-5 h-5 ${isFocused ? 'text-indigo-400' : 'text-gray-500'}`} />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
        />
        {query && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={handleClear}
            className="p-1 rounded-full hover:bg-white/10"
          >
            <X className="w-4 h-4 text-gray-400" />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
