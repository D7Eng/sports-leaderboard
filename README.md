# Sports Leaderboard

A live leaderboard for intramurals, campus events and leagues, built for any sport. It works on phones and desktops.

- **Students** sign up with their email and view standings and results.
- **Coordinators** also enter match scores and event placings, and can remove mistakes.
- **Admins** also set up competitions, colleges or teams, and sports, and choose who is a coordinator or admin.

It's a plain static website (HTML, CSS and JavaScript, with no build step). [Supabase](https://supabase.com) provides sign-up, logins and the database. The database's own row-level security rules enforce each role, so a student can't change scores even with developer tools.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The website |
| `config.js` | Your Supabase project URL and anon key |
| `supabase/schema.sql` | Tables, roles and access rules. Run it once in Supabase. |

## Setup (about 15 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com and create a new project. The free plan is fine.
2. Open **SQL Editor**, then **New query**. Paste in all of `supabase/schema.sql` and click **Run**.
3. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `config.js`.

### 2. Put the site online with GitHub Pages
1. Create a GitHub repository and push these files to it.
2. In the repository, open **Settings → Pages**. Choose **Deploy from a branch**, pick `main` and `/ (root)`, then save.
3. Your site will be at `https://<your-username>.github.io/<repo-name>/`.

Netlify, Vercel and Cloudflare Pages also work. Point them at the folder; there's nothing to build.

### 3. Tell Supabase where the site lives
In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to your site's address and add the same address under **Redirect URLs**. Confirmation and password-reset emails link back to this address.

### 4. Make yourself the admin
1. Open your site and sign up. Then confirm your email.
2. In Supabase's **SQL Editor**, run this with your own email:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
3. Reload the site. You'll see the **Setup** and **People** tabs.

From then on, you manage roles in the **People** tab. Students sign themselves up, and you switch the people who will run each sport to **Coordinator**.

## Good to know
- **Email confirmation:** Supabase asks new users to confirm their email by default. The free plan's built-in email service sends only a few emails per hour, which is fine for testing. Before a whole school signs up, add your own email provider under **Authentication → Emails → SMTP Settings**.
- **School emails only:** to allow only school addresses, you can add a check to `handle_new_user` in `schema.sql`, or use Supabase's sign-up hooks.
- **Live updates:** open pages refresh by themselves when anyone saves a score.
- **Overall standings:** in each sport, the current top 3 earn gold, silver and bronze, plus overall points (5, 3 and 1 by default; you can change them per competition).
