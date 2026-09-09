import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://mcbjmnjmcyvgtkewjtlr.supabase.co'
const supabaseKey = 'sb_publishable_0nFwmXrYGO9NBeQ67qYd_Q_Ylqpy6hk'

export const supabase = createClient(supabaseUrl, supabaseKey)
