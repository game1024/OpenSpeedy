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
  最高のオープンソース ゲームスピードコントローラー
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
    <img src="https://img.shields.io/github/commit-activity/m/game1024/OpenSpeedy?style=for-the-badge" alt="コミットアクティビティ">
  </a>
  <img src="https://img.shields.io/badge/language-C/C++-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/License-GPLv3-green.svg?style=for-the-badge">
  <br/>

  <a href="https://hellogithub.com/repository/975f473c56ad4369a1c30ac9aa5819e0" target="_blank">
    <img src="https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=975f473c56ad4369a1c30ac9aa5819e0&claim_uid=kmUCncHJr9SpNV7&theme=neutral" alt="Featured｜HelloGitHub" style="width: 250px; height: 54px;" width="250" height="54" />
  </a>
</p>


# 🚀 特徴
- クイック速度調整
- モダンなUI
- x86 と x64 の両方のプラットフォームプロセスに対応
- カーネル侵入なし — Ring-3 レベルのフック、システムカーネルを改変しません


# 💾 インストール
📦 **方法1: Winget**

``` powershell
# インストールコマンド
winget install openspeedy

# 新しいターミナルを開いて openspeedy を実行
openspeedy
```

📥 **方法2: 手動ダウンロード**

[リリースページ](https://github.com/game1024/OpenSpeedy/releases)にアクセスして最新バージョンをダウンロードしてください。


# 💻 システム要件
- OS: Windows 10 以上
- プラットフォーム: x86（32ビット）および x64（64ビット）


# 📝 使い方
1. OpenSpeedy を起動
2. 加速したいターゲットゲームを実行
<img src="https://github.com/user-attachments/assets/648e721d-9c3a-4d82-954c-19b16355d084" width="50%">

3. ゲームプロセスを選択し、OpenSpeedy インターフェースで速度倍率を調整
<img src="https://github.com/user-attachments/assets/9cd56353-1906-44c5-ba29-b5b4d2db2b80" width="50%"/>

4. すぐに効果が反映されます — 以下の比較をご覧ください

<video src="https://github.com/user-attachments/assets/7c75e37d-bc7a-4639-89a0-a34a21676cba" width="70%"></video>

# 🔧 技術原理

プロジェクトのビルド方法については、[開発者ドキュメント](https://github.com/game1024/OpenSpeedy/wiki/%E5%BC%80%E5%8F%91%E8%80%85%E6%96%87%E6%A1%A3)を参照してください。

OpenSpeedy は以下の Windows システム時間関数をフックすることでゲーム速度を調整します：

| 関数 | ライブラリ | 機能 |
|----------|---------|---------|
| Sleep | user32.dll | スレッドスリープ |
| SetTimer | user32.dll | メッセージベースのタイマーを作成 |
| timeGetTime | winmm.dll | システム起動後の経過ミリ秒を取得 |
| GetTickCount | kernel32.dll | システム起動後の経過ミリ秒を取得 |
| GetTickCount64 | kernel32.dll | システム起動後の経過ミリ秒を取得（64ビット） |
| QueryPerformanceCounter | kernel32.dll | 高精度パフォーマンスカウンター |
| GetSystemTimeAsFileTime | kernel32.dll | システム時刻を取得 |
| GetSystemTimePreciseAsFileTime | kernel32.dll | 高精度システム時刻を取得 |

# ⚠️ 注意事項
- 本ツールは学習および研究目的のみに使用してください
- 一部のオンラインゲームにはアンチチートシステムが搭載されており、本ツールの使用によりアカウントが停止される場合があります
- 過度な加速はゲームの物理エンジンの異常やクラッシュを引き起こす可能性があります
- 競技系オンラインゲームでの使用は推奨しません
- デジタル署名のないオープンソースソフトウェアは、アンチウイルスソフトに誤検出される可能性があります

# 🔄 フィードバック
問題が発生した場合は、以下の方法でご連絡ください：
- [FAQ](https://github.com/game1024/OpenSpeedy/wiki#faq) — まずはWikiでよくある問題を確認してください
- [GitHub Issues](https://github.com/game1024/OpenSpeedy/issues) — バグ報告を提出してください。クラウドストレージ関連の問題は提出しないでください。ご協力ありがとうございます～🙏


# 📜 ライセンス
OpenSpeedy は GPL v3 ライセンスに基づいています。

# 🙏 謝辞
OpenSpeedy は以下のプロジェクトのソースコードを使用しています。オープンソースコミュニティに感謝します！OpenSpeedy がお役に立ったら、Star をお願いします！
- [minhook](https://github.com/TsudaKageyu/minhook): APIフック用
- [tauri](https://tauri.app/): GUI

免責事項: OpenSpeedy は教育および研究目的のみを目的としています。ユーザーは本ソフトウェアの使用に関連するすべてのリスクと責任を負うものとします。作者は本ソフトウェアの使用に起因するいかなる損失または法的責任についても責任を負いません。

<a href="https://openomy.com/game1024/openspeedy" target="_blank" style="display: block; width: 100%;" align="center">
  <img src="https://openomy.com/svg?repo=game1024/openspeedy&chart=bubble&latestMonth=6" target="_blank" alt="Contribution Leaderboard" style="display: block; width: 100%;" />
</a>


<p align="center">
  <img src="https://api.star-history.com/svg?repos=game1024/openspeedy&type=Date" Alt="Star History Chart">
</p>
