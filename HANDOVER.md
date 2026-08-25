# Ground Zero Contractors Inc. — Site Handover

## 1. Live Website

**Public URL:** https://transcendent-swan-230515.netlify.app  
**Custom Domain:** gzci.ca *(pending DNS — point Namecheap CNAME to Netlify after invoice settled)*

The site has two parts:
- **Landing page** (gzci.ca) — public brochure, services, contact
- **Staff/Client Dashboard** (gzci.ca/app/login) — password-protected project management

---

## 2. How To Log In

Go to **gzci.ca/app/login** (or the Netlify URL above for now).

| Who | Email | Password | Can Do |
|-----|-------|----------|--------|
| **Peter** (owner) | peter@gzci.ca | PeterSabota | Full access: create projects, log production, manage everything |
| **Hanna** | hanna@gzci.ca | PeterSabota | Full access: same as Peter |
| **Mike** | mike@gzci.ca | PeterSabota | Create projects + view only (cannot delete entries) |
| **Clients** | (set per project) | (set per project) | View their own project only + create entries |

---

## 3. How To Create A New Project

1. Login as **Peter** or **Hanna** or **Mike**
2. Click **+ New Project** on the dashboard
3. Follow the 4-step wizard:
   - **Step 1 — Project Info:** Name, Type (demo/excavation/etc.)
   - **Step 2 — Contacts:** Add client contacts with name, email, and a **custom password**
   - **Step 3 — Folders:** Pick a folder structure template (chips appear)
   - **Step 4 — Review:** Confirm everything and submit

**Client accounts are created automatically.** When you create a project with a client's email, they get a login instantly. Their password is shown once on the success screen — **write it down**.

---

## 4. How To View Client Passwords Later

Open any project's **Production Log** page. Scroll down — you'll see a **Client Passwords** table listing every client on that project with their email and password. Only Peter, Hanna, and Mike can see this; clients cannot.

---

## 5. How To Log Production (Daily Quantities)

1. Open a project
2. Click **+ Log Entry**
3. Enter the **date** and **quantity** (e.g., cubic metres of earth moved)
4. It appears in the table below

---

## 6. How To Remove An Entry

Only **Peter** and **Hanna** see the **Remove** button. Click it to delete an entry.

---

## 7. Accessing Supabase (Database Backend)

If you need to access the database directly (e.g., to export data or add users):

1. Go to https://supabase.com/dashboard/project/hvxxcqddqdtbllzrzeqf
2. Login: **peter@gzci.ca** (Supabase project owner — transferred from admin account)

Here you can:
- Browse the **projects** and **production_entries** tables
- Manually add/remove auth users (under **Authentication → Users**)
- View/edit data with the Table Editor

> **IT Admin:** William Commu (william@justmemedia.ca) has member-level access to the Supabase project.

---

## 8. Accessing Netlify

1. Go to https://app.netlify.com
2. Login: **peter@gzci.ca** (William logs in directly using Peter's credentials — no paid team member needed)
3. Find the site "transcendent-swan-230515"
4. Here you can: view deploy logs, set environment variables, configure custom domain

---

## 9. Accessing GitHub

1. Go to https://github.com/Lexsort-Core/ground-zero-contractors
2. Peter Sabota is added as a collaborator on the repo.
3. The source code is here. Pushing to `main` triggers an automatic deploy to Netlify.

> **Repo Owner:** William Commu via Lexsort-Core org (IT admin).

---

## 10. Role Summary

| Role | Create Projects | Log Production | Delete Entries | See Client Passwords | See All Projects |
|------|:-:|:-:|:-:|:-:|:-:|
| **full** (Peter, Hanna) | Yes | Yes | Yes | Yes | Yes |
| **limited** (Mike) | Yes | Yes | No | Yes | Yes |
| **client** | No | Yes (own project) | No | No | Own project only |

---

## 11. Pending Items

> **Note:** William handles all account setup on Peter's behalf using access to the gzci.ca email portal. Peter does not need IT knowledge — William does it for him.

- [ ] **Pay invoice GZCI-001** — $500.00 CAD to JustMeMedia (e-transfer: wcommu@justmemedia.ca)
- [ ] **Create Peter's Netlify account** — William signs up at netlify.com using `peter@gzci.ca`, confirms via gzci.ca webmail
- [ ] **Transfer Netlify site** — From William's personal Netlify → transfer to `peter@gzci.ca` account; then add `william@justmemedia.ca` as team member
- [ ] **Transfer Supabase project** — Settings → General → Transfer ownership to `peter@gzci.ca`; confirm via gzci.ca webmail; add William as member
- [ ] **Point DNS** at Namecheap: set `www.gzci.ca` CNAME → `transcendent-swan-230515.netlify.app`
- [ ] **Remove orphaned `admin@gzci.ca` app user** from Supabase Auth → Authentication → Users (account deleted, entry is stale)
- [ ] **Add Peter as GitHub collaborator** on `Lexsort-Core/ground-zero-contractors` (optional — he doesn't need code access)
- [ ] **Distribute logins** to Hanna and Mike (password: PeterSabota)
- [ ] **File Dropbox module** — build & deploy drag-and-drop upload portal (included in GZCI-001)

---

*For questions, contact William Commu — JustMeMedia*  
📧 wcommu@justmemedia.ca · 📞 647-554-0219
