export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      trips: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          title: string;
          destination: string;
          start_date: string;
          end_date: string;
          duration_days: number;
          preferences: Json;
          data: Json;
          share_code: string;
          visibility: 'public' | 'friends' | 'private';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          title: string;
          destination: string;
          start_date: string;
          end_date: string;
          duration_days: number;
          preferences: Json;
          data: Json;
          share_code?: string;
          visibility?: 'public' | 'friends' | 'private';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          title?: string;
          destination?: string;
          start_date?: string;
          end_date?: string;
          duration_days?: number;
          preferences?: Json;
          data?: Json;
          share_code?: string;
          visibility?: 'public' | 'friends' | 'private';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trips_owner_id_fkey";
            columns: ["owner_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      trip_members: {
        Row: {
          id: string;
          trip_id: string;
          user_id: string;
          role: 'owner' | 'editor' | 'viewer';
          joined_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          user_id: string;
          role: 'owner' | 'editor' | 'viewer';
          joined_at?: string;
        };
        Update: {
          id?: string;
          trip_id?: string;
          user_id?: string;
          role?: 'owner' | 'editor' | 'viewer';
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_members_trip_id_fkey";
            columns: ["trip_id"];
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_members_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      proposals: {
        Row: {
          id: string;
          trip_id: string;
          author_id: string;
          title: string;
          description: string | null;
          changes: Json;
          status: 'pending' | 'approved' | 'rejected' | 'merged';
          votes_for: number;
          votes_against: number;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          trip_id: string;
          author_id: string;
          title: string;
          description?: string | null;
          changes: Json;
          status?: 'pending' | 'approved' | 'rejected' | 'merged';
          votes_for?: number;
          votes_against?: number;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          trip_id?: string;
          author_id?: string;
          title?: string;
          description?: string | null;
          changes?: Json;
          status?: 'pending' | 'approved' | 'rejected' | 'merged';
          votes_for?: number;
          votes_against?: number;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "proposals_trip_id_fkey";
            columns: ["trip_id"];
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proposals_author_id_fkey";
            columns: ["author_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      votes: {
        Row: {
          id: string;
          proposal_id: string;
          user_id: string;
          vote: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          proposal_id: string;
          user_id: string;
          vote: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          proposal_id?: string;
          user_id?: string;
          vote?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "votes_proposal_id_fkey";
            columns: ["proposal_id"];
            referencedRelation: "proposals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "votes_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      activity_log: {
        Row: {
          id: string;
          trip_id: string;
          user_id: string;
          action: string;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          user_id: string;
          action: string;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          trip_id?: string;
          user_id?: string;
          action?: string;
          details?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_trip_id_fkey";
            columns: ["trip_id"];
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      user_preferences: {
        Row: {
          id: string;
          user_id: string;
          favorite_activities: string[];
          travel_style: 'adventurous' | 'relaxed' | 'cultural' | 'party' | 'balanced';
          budget_preference: 'budget' | 'moderate' | 'comfort' | 'luxury';
          accommodation_preference: 'hostel' | 'hotel' | 'airbnb' | 'luxury';
          pace_preference: 'relaxed' | 'moderate' | 'intense';
          dietary_restrictions: string[];
          cuisine_preferences: string[];
          allergies: string[];
          accessibility_needs: string[];
          preferred_language: string;
          preferred_currency: string;
          wake_up_time: 'early' | 'normal' | 'late';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          favorite_activities?: string[];
          travel_style?: 'adventurous' | 'relaxed' | 'cultural' | 'party' | 'balanced';
          budget_preference?: 'budget' | 'moderate' | 'comfort' | 'luxury';
          accommodation_preference?: 'hostel' | 'hotel' | 'airbnb' | 'luxury';
          pace_preference?: 'relaxed' | 'moderate' | 'intense';
          dietary_restrictions?: string[];
          cuisine_preferences?: string[];
          allergies?: string[];
          accessibility_needs?: string[];
          preferred_language?: string;
          preferred_currency?: string;
          wake_up_time?: 'early' | 'normal' | 'late';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          favorite_activities?: string[];
          travel_style?: 'adventurous' | 'relaxed' | 'cultural' | 'party' | 'balanced';
          budget_preference?: 'budget' | 'moderate' | 'comfort' | 'luxury';
          accommodation_preference?: 'hostel' | 'hotel' | 'airbnb' | 'luxury';
          pace_preference?: 'relaxed' | 'moderate' | 'intense';
          dietary_restrictions?: string[];
          cuisine_preferences?: string[];
          allergies?: string[];
          accessibility_needs?: string[];
          preferred_language?: string;
          preferred_currency?: string;
          wake_up_time?: 'early' | 'normal' | 'late';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      trip_likes: {
        Row: {
          id: string;
          trip_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          trip_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_likes_trip_id_fkey";
            columns: ["trip_id"];
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_likes_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      expenses: {
        Row: {
          id: string;
          trip_id: string;
          title: string;
          amount: number;
          currency: string;
          category: string;
          date: string;
          notes: string | null;
          payer_id: string;
          split_method: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          title: string;
          amount: number;
          currency?: string;
          category?: string;
          date: string;
          notes?: string | null;
          payer_id: string;
          split_method?: string;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          trip_id?: string;
          title?: string;
          amount?: number;
          currency?: string;
          category?: string;
          date?: string;
          notes?: string | null;
          payer_id?: string;
          split_method?: string;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_trip_id_fkey";
            columns: ["trip_id"];
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_payer_id_fkey";
            columns: ["payer_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      expense_splits: {
        Row: {
          id: string;
          expense_id: string;
          user_id: string;
          amount: number;
          share_value: number | null;
        };
        Insert: {
          id?: string;
          expense_id: string;
          user_id: string;
          amount: number;
          share_value?: number | null;
        };
        Update: {
          id?: string;
          expense_id?: string;
          user_id?: string;
          amount?: number;
          share_value?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_splits_expense_id_fkey";
            columns: ["expense_id"];
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_splits_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      settlements: {
        Row: {
          id: string;
          trip_id: string;
          from_user_id: string;
          to_user_id: string;
          amount: number;
          settled_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          from_user_id: string;
          to_user_id: string;
          amount: number;
          settled_at?: string;
          created_by: string;
        };
        Update: {
          id?: string;
          trip_id?: string;
          from_user_id?: string;
          to_user_id?: string;
          amount?: number;
          settled_at?: string;
          created_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settlements_trip_id_fkey";
            columns: ["trip_id"];
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_from_user_id_fkey";
            columns: ["from_user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_to_user_id_fkey";
            columns: ["to_user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      trip_comments: {
        Row: {
          id: string;
          trip_id: string;
          user_id: string;
          content: string;
          parent_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          user_id: string;
          content: string;
          parent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          trip_id?: string;
          user_id?: string;
          content?: string;
          parent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_comments_trip_id_fkey";
            columns: ["trip_id"];
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_comments_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_comments_parent_id_fkey";
            columns: ["parent_id"];
            referencedRelation: "trip_comments";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Helper types
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Trip = Database['public']['Tables']['trips']['Row'];
export type TripMember = Database['public']['Tables']['trip_members']['Row'];
export type Proposal = Database['public']['Tables']['proposals']['Row'];
export type Vote = Database['public']['Tables']['votes']['Row'];
export type ActivityLog = Database['public']['Tables']['activity_log']['Row'];
export type UserPreferences = Database['public']['Tables']['user_preferences']['Row'];
export type TripLike = Database['public']['Tables']['trip_likes']['Row'];
export type TripComment = Database['public']['Tables']['trip_comments']['Row'];

// Extended types with relations
export interface TripWithMembers extends Trip {
  members: (TripMember & { profile: Profile })[];
}

export interface ProposalWithAuthor extends Proposal {
  author: Profile;
  votes: Vote[];
}

export interface TripMemberWithProfile extends TripMember {
  profile: Profile;
}

// Social types
export interface PublicTrip {
  id: string;
  owner_id: string;
  title: string;
  destination: string;
  start_date: string;
  duration_days: number;
  data: Json;
  visibility: 'public' | 'friends' | 'private';
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  owner_avatar: string | null;
  likes_count: number;
  comments_count: number;
}

export interface TripCommentWithAuthor extends TripComment {
  author: Profile;
}
