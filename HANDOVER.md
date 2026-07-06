# Ground Zero Contractors Inc. — Site Handover

## 1. Live Website

**Public URL:** https://transcendent-swan-230515.netlify.app  
**Custom Domain:** gzci.ca *(not yet live — DNS paused until invoice paid)*

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
2. Login: **admin@gzci.ca** / **PeterSabota#69**

Here you can:
- Browse the **projects** and **production_entries** tables
- Manually add/remove auth users (under **Authentication → Users**)
- View/edit data with the Table Editor

---

## 8. Accessing Netlify

1. Go to https://app.netlify.com
2. Login: **admin@gzci.ca** / **PeterSabota#69**
3. Find the site "transcendent-swan-230515"
4. Here you can: view deploy logs, set environment variables, configure custom domain

---

## 9. Accessing GitHub

1. Go to https://github.com/GroundZeroCI/ground-zero-contractors
2. Login: **admin@gzci.ca** / **PeterSabota#69**
3. The source code is here. Pushing to `main` triggers an automatic deploy to Netlify.

---

## 10. Role Summary

| Role | Create Projects | Log Production | Delete Entries | See Client Passwords | See All Projects |
|------|:-:|:-:|:-:|:-:|:-:|
| **admin** (admin@gzci.ca) | Yes | Yes | Yes | Yes | Yes |
| **full** (Peter, Hanna) | Yes | Yes | Yes | Yes | Yes |
| **limited** (Mike) | Yes | Yes | No | Yes | Yes |
| **client** | No | Yes (own project) | No | No | Own project only |

---

## 11. Pending Items

- [ ] **Pay invoice** from JustMeMedia to unlock full handover
- [ ] **Point DNS** at Namecheap: set `www.gzci.ca` CNAME → `transcendent-swan-230515.netlify.app`
- [ ] **Transfer Netlify site** to admin@gzci.ca (currently under William's personal Netlify account)
- [ ] **Distribute logins** to Hanna and Mike (they each get PeterSabota)

---

*For questions, contact William Commu — JustMeMedia*
