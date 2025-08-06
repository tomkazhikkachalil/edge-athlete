# 🚀 Quick Start

Welcome! Your coding environment is loading. Follow these 6 steps:

## 1️⃣ Wait for Codespaces to Fully Set Up
⏳ **Important:** Codespaces can take 2-4 minutes to set up completely. Multiple steps will take place autonomously.
- Wait until the setup window that says "✔ Finishing up... Running postCreateCommand... npm install && npm install -g @anthropic-ai/claude-code" closes automatically. 
- This means Codespaces is finally ready!
- Come back to this README.md tab and follow step 2.

## 2️⃣ Get Your API Keys
Ask your instructor for the `.env.local` file contents, then:
- In the Explorer panel (left sidebar), hover over the project name
- Click the **New File** icon that appears (looks like a page with a +)
- Name it `.env.local` 
- Paste the API keys your instructor gave you

## 3️⃣ Start Your App
In the terminal below, type: `npm run dev`

Your app will open automatically in the main editor area (to the right)! ➡️

## 4️⃣ Use Claude Code AI
In the tab called "Claude Terminal" in the main editor area (next to the README.md tab), type: `claude`

Claude will ask you some questions to get set up.

## 5️⃣ Split Screen Setup
We want Codespaces to have a split screen layout:
- Browser on the right hand side
- Claude Code on the left
- Terminal at the bottom

If it doesn't look this way, right click the tabs you want to move and hit "Split Right" or "Split Left". You may also need to drag the tabs around until you are happy with the layout.

## 6️⃣ Back to Generation AI and Alex Specs
Once your split screen is set up correctly, go back to Generation AI and let Alex Specs know your GitHub Codespaces is set up.

**That's it! You're ready to code!** 🎉

Scroll down for more details about your app...

## 🎨 What's In This Starter App?

- ✨ **AI Text Processing** - Chat with AI
- 🖼️ **AI Image Analysis** - AI can understand images
- 🔐 **User Login** - Magic link authentication (no passwords!)
- 💾 **Database** - Store user data with Prisma & Supabase
- 📧 **Email System** - Send emails to users
- 👤 **Admin Panel** - Manage users (admins only)

## 📂 Project Structure

```
src/app/           # Your pages (each folder = a route)
src/app/api/       # Backend API endpoints
src/components/    # Reusable React components
src/lib/           # Helper functions
public/            # Images and static files
```

## 🛠️ Useful Commands

Type these in the terminal:

```bash
npm run dev        # Start development server (auto-runs in Codespaces!)
npm run build      # Check if your app builds correctly
npm run lint       # Check code quality
npm run studio     # Open Prisma Studio (database viewer)
```

## 🤖 Using Claude Code

Claude Code is your AI assistant that helps you code:

1. **Start Claude:**
   ```bash
   claude-code
   ```

2. **Ask for Help:**
   - "Explain this code"
   - "Help me create a new page"
   - "Fix this error"
   - "How do I add a button that..."

3. **Let Claude See Your Code:**
   - Claude can read your files
   - It understands your project structure
   - Ask specific questions about your code

## 🚨 Troubleshooting

**Can't see your app?**
- Check the terminal for errors
- Make sure `.env.local` is set up
- Try refreshing the Simple Browser

**Changes not showing?**
- Make sure you saved the file
- Check if the dev server is still running
- Look for errors in the terminal

**Database errors?**
- Make sure you have `.env.local` with database credentials
- Run `npm run setup` to initialize the database

## 💡 Pro Tips for Codespaces

1. **Auto-save is ON** - Your code saves automatically after 1 second
2. **Everything is in the cloud** - No need to worry about losing work
3. **Commit often** - Use the Source Control tab to save your progress
4. **Terminal is powerful** - Run commands, see errors, restart servers
5. **Extensions included** - ESLint, Prettier, Tailwind CSS support all ready

## 🎯 Next Steps

1. ✅ Make sure your app is running (check Simple Browser)
2. ✅ Get `.env.local` from your teacher
3. ✅ Change the app name and homepage text
4. ✅ Read the welcome page instructions after logging in
5. ✅ Start building your amazing app!

## 📚 Need More Help?

- **Technical Details**: Check `CLAUDE.md` (for AI assistants)
- **Ask Claude**: Type `claude-code` in the terminal
- **Ask Your Teacher**: They're here to help!
- **Work Together**: Share your Codespace URL with classmates

---

**Remember:** This is YOUR app now. Break things, experiment, and have fun building! 🌟

*P.S. Codespaces auto-saves and syncs everything. Just focus on coding!*