'use client';

import { useRouter } from 'next/navigation';

interface UserProfileCardProps {
  user: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    username?: string | null;
    bio?: string | null;
  };
  subtitle?: string;
  showArrow?: boolean;
}

export function UserProfileCard({ user, subtitle, showArrow = true }: UserProfileCardProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(`/v2/user/${user.id}`)}
      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-[#1a1a24] transition-colors text-left"
    >
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center overflow-hidden flex-shrink-0">
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-white font-semibold text-sm">
            {(user.display_name || '?')[0].toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-sm truncate">
          {user.display_name || 'Utilisateur'}
        </p>
        {(subtitle || user.username) && (
          <p className="text-gray-500 text-xs truncate">
            {subtitle || `@${user.username}`}
          </p>
        )}
      </div>
      {showArrow && (
        <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}
