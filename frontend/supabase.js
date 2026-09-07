import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://kyrzkjpbqkwnwqmcgykq.supabase.co";

const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5cnpranBicWt3bndxbWNneWtxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTQ5NzQsImV4cCI6MjEwMDEzMDk3NH0.nsSZJoE7OPESCI53u9gxqcBCIWmPzhXkFADQiByUT0w";

export const supabase = createClient(
    supabaseUrl,
    supabaseAnonKey
);