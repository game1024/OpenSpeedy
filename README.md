<p align="center">
  <a href="https://ref.365tz87989.com/?r=RWQVZD">
  <img width="1584" height="672" alt="Gemini_Generated_Image_n3p4rln3p4rln3p4" src="https://github.com/user-attachments/assets/572fbf30-5d58-4b1d-b28e-b07494585ffa" />
  </a>
</p>

<h1 align="center"> OpenSpeedy </h1>

<p align="center">
  <img style="margin:0 auto" width=100 height=100 src="https://github.com/user-attachments/assets/a82ceda2-9b7b-41e4-96dc-cd250c9bd3ff">
  </img>  
</p>

<p align="center">
  最好用的开源游戏变速器
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
    <img src="https://img.shields.io/github/commit-activity/m/game1024/OpenSpeedy?style=for-the-badge" alt="提交活跃度">
  </a>
  <img src="https://img.shields.io/badge/language-C/C++-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/License-GPLv3-green.svg?style=for-the-badge">
  <br/>

  <a href="https://hellogithub.com/repository/975f473c56ad4369a1c30ac9aa5819e0" target="_blank">
    <img src="https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=975f473c56ad4369a1c30ac9aa5819e0&claim_uid=kmUCncHJr9SpNV7&theme=neutral" alt="Featured｜HelloGitHub" style="width: 250px; height: 54px;" width="250" height="54" />
  </a>
</p>

<p align="center">
  🌐 <a href="https://github.com/game1024/OpenSpeedy/blob/master/README.en-US.md">English</a> |
  <a href="https://github.com/game1024/OpenSpeedy/blob/master/README.de-DE.md">Deutsch</a> |
  <a href="https://github.com/game1024/OpenSpeedy/blob/master/README.fr-FR.md">Français</a> |
  <a href="https://github.com/game1024/OpenSpeedy/blob/master/README.ja-JP.md">日本語</a> |
  <a href="https://github.com/game1024/OpenSpeedy/blob/master/README.ko-KR.md">한국어</a> |
  <a href="https://github.com/game1024/OpenSpeedy/blob/master/README.md">中文</a>
</p>


# 🚀 特性
- 快捷变速
- 现代化UI
- 同时可以支持x86和x64平台进程
- 无内核侵入性，Ring3层Hook，不破坏系统内核


# 💾 安装
📦 **方式1: Winget**

``` powershell
# 安装命令如下
winget install openspeedy

# 打开一个新的终端，运行openspeedy
openspeedy
```

📥 **方式2: 手动下载**

访问 [安装页面](https://github.com/game1024/OpenSpeedy/releases) 下载最新版本


# 💻 操作系统要求
- OS: Windows10 以上
- 平台：x86（32位） 和 x64 （64位）


# 📝 使用说明
1. 启动 OpenSpeedy
2. 运行需要变速的目标游戏
<img src="https://github.com/user-attachments/assets/648e721d-9c3a-4d82-954c-19b16355d084" width="50%">

3. 勾选游戏进程，在 OpenSpeedy 界面中调整速度倍率
<img src="https://github.com/user-attachments/assets/9cd56353-1906-44c5-ba29-b5b4d2db2b80" width="50%"/>


4. 即刻生效，对比效果如下

<video src="https://github.com/user-attachments/assets/7c75e37d-bc7a-4639-89a0-a34a21676cba" width="70%"></video>

# 🔧 技术原理

如果想要了解如何编译项目，可以参考[开发者文档](https://github.com/game1024/OpenSpeedy/wiki/%E5%BC%80%E5%8F%91%E8%80%85%E6%96%87%E6%A1%A3)

OpenSpeedy 通过 Hook 以下 Windows 系统时间函数来实现游戏速度调整：

|函数名	| 所属库 |	功能 |
|--------|----------|------------------|
|Sleep|user32.dll|线程休眠|
|SetTimer|user32.dll|创建基于消息的计时器|
|timeGetTime | winmm.dll	| 获取系统启动后经过的毫秒数 |
|GetTickCount | kernel32.dll	| 获取系统启动后经过的毫秒数 |
|GetTickCount64	| kernel32.dll	| 获取系统启动后经过的毫秒数(64位) |
|QueryPerformanceCounter |	kernel32.dll	| 高精度性能计数器 |
|GetSystemTimeAsFileTime |	kernel32.dll	| 获取系统时间 |
|GetSystemTimePreciseAsFileTime |	kernel32.dll	| 获取高精度系统时间 |

# ⚠️ 注意事项
- 本工具仅供学习和研究使用
- 部分在线游戏可能有反作弊系统，使用本工具可能导致账号被封禁
- 过度加速可能导致游戏物理引擎异常或崩溃
- 不建议在竞技类在线游戏中使用
- 开源产品不带数字签名，可能被杀毒软件误报

# 🔄 反馈
如果在使用过程中遇到任何问题，欢迎通过以下方式反馈：
- [FAQ](https://github.com/game1024/OpenSpeedy/wiki#faq) - 先查看wiki定位常见问题
- [GitHub Issues](https://github.com/game1024/OpenSpeedy/issues) - 提交问题报告, 网盘类问题请勿提issue, 我不支持, 谢谢合作～🙏


# 📜 开源协议
OpenSpeedy 遵循 GPL v3 许可证。

# 🙏 鸣谢
OpenSpeedy使用到以下项目的源码，感谢开源社区的力量，如果OpenSpeedy对你有帮助，欢迎Star!
- [minhook](https://github.com/TsudaKageyu/minhook): 用于API Hook
- [tauri](https://tauri.app/): GUI

免责声明: OpenSpeedy 仅用于教育和研究目的。用户应自行承担使用本软件的所有风险和责任。作者不对因使用本软件导致的任何损失或法律责任负责。

<a href="https://openomy.com/game1024/openspeedy" target="_blank" style="display: block; width: 100%;" align="center">
  <img src="https://openomy.com/svg?repo=game1024/openspeedy&chart=bubble&latestMonth=6" target="_blank" alt="Contribution Leaderboard" style="display: block; width: 100%;" />
</a>


<p align="center">
  <img src="https://api.star-history.com/svg?repos=game1024/openspeedy&type=Date" Alt="Star History Chart">
</p>
