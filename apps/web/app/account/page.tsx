import { redirect } from 'next/navigation';
import { AccountPanel } from '../../features/account/AccountPanel';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { readAccount } from '../../server/auth/account-service';
async function loadAccount(){try{return await readAccount(await createSupabaseServerClient());}catch{redirect('/login?returnTo=/account');}}
export default async function AccountPage(){return <AccountPanel account={await loadAccount()}/>;}
