// The pilot boards server (PILOT-SPEC.md). Nelson fills these in from his Supabase
// project's API settings: the project URL and the publishable key. The key is meant
// to be public; it only allows calling the board functions in supabase/pilot.sql.
// Nothing else (no link, setting or saved value) can point the app at another server.
export const CLOUD = { url: 'https://juguxjgefzxwdhenekjl.supabase.co', key: 'sb_publishable_df2tUSVz_SyMRkRM2XW3jw_D_uD_mzp' };
