

<h1 align="center"> OpenSpeedy </h1>

<p align="center">
  <img style="margin:0 auto" width=100 height=100 src="https://github.com/user-attachments/assets/a82ceda2-9b7b-41e4-96dc-cd250c9bd3ff">
  </img>  
</p>

<p align="center">
  OpenSpeedy is an open-source and free game speed tool that helps you break frame rate limitations and provides a smoother, silkier gaming acceleration experience.
</p>

<p align="center">
  <img src="https://api.visitorbadge.io/api/visitors?path=game1024.openspeedy&countColor=%234ecdc4">
  <br/>
    
  <a href="https://github.com/game1024/OpenSpeedy/stargazers">
    <img src="https://img.shields.io/github/stars/game1024/OpenSpeedy?style=for-the-badge&color=yellow" alt="GitHub Stars">
  </a>

  <img src="https://img.shields.io/github/forks/game1024/OpenSpeedy?style=for-the-badge&color=8a2be2" alt="GitHub Forks">

  <a href="https://github.com/game1024/OpenSpeedy/issues">
    <img src="https://img.shields.io/github/issues-raw/game1024/OpenSpeedy?style=for-the-badge&label=Issues&color=orange" alt="Github Issues">
  </a>
  <br/>  
  
  <a href="https://github.com/game1024/OpenSpeedy/releases">
    <img src="https://img.shields.io/github/downloads/game1024/OpenSpeedy/total?style=for-the-badge" alt="Downloads">
  </a>
  <a href="https://github.com/game1024/OpenSpeedy/releases">
    <img src="https://img.shields.io/github/v/release/game1024/OpenSpeedy?style=for-the-badge&color=brightgreen" alt="Version">
  </a>
  <a href="https://github.com/game1024/OpenSpeedy/actions">
      <img src="https://img.shields.io/github/actions/workflow/status/game1024/OpenSpeedy/ci.yml?style=for-the-badge" alt="Github Action">
  </a>
  <a href="https://github.com/game1024/OpenSpeedy">
    <img src="https://img.shields.io/badge/Platform-Windows-lightblue?style=for-the-badge" alt="Platform">
  </a>
  <br/>
  
  <a href="https://github.com/game1024/OpenSpeedy/commits">
    <img src="https://img.shields.io/github/commit-activity/m/game1024/OpenSpeedy?style=for-the-badge" alt="Commit Activity">
  </a>
  <img src="https://img.shields.io/badge/language-C/C++-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/License-GPLv3-green.svg?style=for-the-badge">
  <br/>

  <a href="https://hellogithub.com/repository/975f473c56ad4369a1c30ac9aa5819e0" target="_blank">
    <img src="https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=975f473c56ad4369a1c30ac9aa5819e0&claim_uid=kmUCncHJr9SpNV7&theme=neutral" alt="Featured｜HelloGitHub" style="width: 250px; height: 54px;" width="250" height="54" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/game1024/OpenSpeedy/blob/master/docs/README_cn.md">
    简体中文
  </a>
  ·
  <a href="https://github.com/game1024/OpenSpeedy/blob/master/docs/README_ja.md">
    日本語
  </a>
  ·
  <a href="https://github.com/game1024/OpenSpeedy?tab=readme-ov-file#-openspeedy-">
    English
  </a>
</p>

# 🚀 Features
- Completely free and open-source
- Easy-to-use interface
- Customizable speed multiplier
- Good compatibility with various game engines
- Low system resource consumption
- Supports accelerating both x86 and x64 processes
- Non-invasive to the kernel: Ring3 level Hook, does not compromise the system kernel

# 💾 Installation
📦 **Method1: Winget**

``` powershell
# install 
winget install openspeedy

# open a new terminal, you can run openspeedy by following command
speedy
``` 

📥 **Method2: Manual Download**

Visit the [Installation Page](https://github.com/game1024/OpenSpeedy/releases) to download the latest version



# 💻 System Requirements
- OS: Windows 10 or later
- Platform: x86 (32-bit) and x64 (64-bit)

# 📝 Usage Instructions
1. Start OpenSpeedy
2. Launch the target game you want to speed up
<img src="https://github.com/user-attachments/assets/648e721d-9c3a-4d82-954c-19b16355d084" width="50%">

3. Select the game process, and adjust the speed multiplier in the OpenSpeedy interface
<img src="https://github.com/user-attachments/assets/9469aae9-8be0-4e40-884d-1fbea3206e73" width="50%">

4. The effect takes effect immediately. Compare the results below

<video src="https://github.com/user-attachments/assets/74471b1f-7f95-4de8-b5aa-7edc85c9d5f0" width="70%"></video>

# 🔧 Technical Principle
OpenSpeedy achieves game speed adjustment by hooking the following Windows system time functions:

| Function Name | Library | Description |
|---------------|---------|-------------|
| Sleep | user32.dll | Thread sleep |
| SetTimer | user32.dll | Create message-based timer |
| timeGetTime | winmm.dll | Get milliseconds elapsed since system startup |
| GetTickCount | kernel32.dll | Get milliseconds elapsed since system startup |
| GetTickCount64 | kernel32.dll | Get milliseconds elapsed since system startup (64-bit) |
| QueryPerformanceCounter | kernel32.dll | High precision performance counter |
| GetSystemTimeAsFileTime | kernel32.dll | Get system time |
| GetSystemTimePreciseAsFileTime | kernel32.dll | Get high precision system time |

# ⚠️ Notes
- This tool is for learning and research purposes only
- Some online games may have anti-cheat systems. Using this tool may result in your account being banned
- Excessive speeding up may cause the game physics engine to malfunction or crash
- Not recommended for use in competitive online games
- Open source product does not include digital signature and may be falsely flagged by antivirus software

# 🔄 Feedback
If you encounter any issues during use, feel free to provide feedback via:
- [FAQ](https://github.com/game1024/OpenSpeedy/wiki#faq) - You can first check the wiki to locate the issue.
- [GitHub Issues](https://github.com/game1024/OpenSpeedy/issues) - Submit issue reports


# 🎁 Buy me a coffee
If you find the OpenSpeedy project helpful, you can buy me a coffee~ ☕️

|Name|Description|
|--|--|
|365VPN|uses dedicated lines to connect worldwide, offering speeds of up to 10Gbps. Download now to start surfing for free🏄: https://ref.365tz87989.com/?r=RWQVZD|


# Sponsors

<table>
  <td>
    <a href="https://signpath.org/" target="_blank"><img src="https://avatars.githubusercontent.com/u/34448643" height="30" alt="SignPath logo" /></a>
  </td>

  <td>
    This program uses free code signing provided by <a href="https://about.signpath.io/?utm_source=foundation&utm_medium=github&utm_campaign=0install">SignPath.io</a> and a certificate by the <a href="https://signpath.org/?utm_source=foundation&utm_medium=github&utm_campaign=0install">SignPath Foundation</a>

  </td>
</table>


# 📜 License
OpenSpeedy is licensed under the GNU v3 License.

# 🙏 Acknowledgements
OpenSpeedy uses source code from the following projects. Thanks to the open-source community! If OpenSpeedy helps you, please give us a Star!
- [minhook](https://github.com/TsudaKageyu/minhook): For API Hooking
- [Qt](https://www.qt.io/): GUI

Disclaimer: OpenSpeedy is intended for educational and research purposes only. Users assume all risks and responsibilities for using this software. The author is not responsible for any loss or legal liability resulting from the use of this software.

<a href="https://openomy.com/game1024/openspeedy" target="_blank" style="display: block; width: 100%;" align="center">
  <img src="https://openomy.com/svg?repo=game1024/openspeedy&chart=bubble&latestMonth=6" target="_blank" alt="Contribution Leaderboard" style="display: block; width: 100%;" />
</a>

<p align="center">
  <img src="https://api.star-history.com/svg?repos=game1024/openspeedy&type=Date" Alt="Star History Chart">
</p>

