<p align="center">
  <a href="https://ref.365tz87989.com/?r=RWQVZD">
  <img src="https://github.com/user-attachments/assets/bde1585b-d0ca-4892-b84a-9c0276804422" />
  </a>
</p>

<h1 align="center"> OpenSpeedy </h1>

<p align="center">
  <img style="margin:0 auto" width=100 height=100 src="https://github.com/user-attachments/assets/a82ceda2-9b7b-41e4-96dc-cd250c9bd3ff">
  </img>  
</p>

<p align="center">
  Le meilleur contrôleur de vitesse de jeu open-source
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
      <img src="https://img.shields.io/github/actions/workflow/status/game1024/OpenSpeedy/build.yml?style=for-the-badge" alt="Github Action">
  </a>
  <a href="https://github.com/game1024/OpenSpeedy">
    <img src="https://img.shields.io/badge/Platform-Windows-lightblue?style=for-the-badge" alt="Platform">
  </a>
  <br/>
  
  <a href="https://github.com/game1024/OpenSpeedy/commits">
    <img src="https://img.shields.io/github/commit-activity/m/game1024/OpenSpeedy?style=for-the-badge" alt="Activité des commits">
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


# 🚀 Fonctionnalités
- Ajustement rapide de la vitesse
- Interface moderne
- Compatible avec les processus x86 et x64
- Aucune intrusion dans le noyau — hooking au niveau Ring-3, ne modifie pas le noyau du système


# 💾 Installation
📦 **Méthode 1 : Winget**

``` powershell
# Commande d'installation
winget install openspeedy

# Ouvrez un nouveau terminal et lancez openspeedy
openspeedy
```

📥 **Méthode 2 : Téléchargement manuel**

Visitez la [page des versions](https://github.com/game1024/OpenSpeedy/releases) pour télécharger la dernière version.


# 💻 Configuration système requise
- OS : Windows 10 ou supérieur
- Plateforme : x86 (32 bits) et x64 (64 bits)


# 📝 Utilisation
1. Lancez OpenSpeedy
2. Lancez le jeu cible que vous souhaitez accélérer
<img src="https://github.com/user-attachments/assets/648e721d-9c3a-4d82-954c-19b16355d084" width="50%">

3. Sélectionnez le processus du jeu et ajustez le multiplicateur de vitesse dans l'interface OpenSpeedy
<img src="https://github.com/user-attachments/assets/9cd56353-1906-44c5-ba29-b5b4d2db2b80" width="50%"/>

4. Effet immédiat — voir la comparaison ci-dessous

<video src="https://github.com/user-attachments/assets/7c75e37d-bc7a-4639-89a0-a34a21676cba" width="70%"></video>

# 🔧 Détails techniques

Prérequis :
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/)
- [CMake](https://cmake.org/)
- [Visual Studio](https://visualstudio.microsoft.com/) (avec la charge de travail « Développement Desktop en C++ »)

Commande de build :

``` powershell
npm run tauri dev
```

OpenSpeedy ajuste la vitesse du jeu en hookant les fonctions de temps système Windows suivantes :

| Fonction | Bibliothèque | Rôle |
|----------|-------------|------|
| Sleep | user32.dll | Mise en veille du thread |
| SetTimer | user32.dll | Crée des minuteurs basés sur les messages |
| timeGetTime | winmm.dll | Récupère le temps de fonctionnement du système en ms |
| GetTickCount | kernel32.dll | Récupère le temps de fonctionnement du système en ms |
| GetTickCount64 | kernel32.dll | Récupère le temps de fonctionnement du système en ms (64 bits) |
| QueryPerformanceCounter | kernel32.dll | Compteur de performance haute résolution |
| GetSystemTimeAsFileTime | kernel32.dll | Récupère l'heure système |
| GetSystemTimePreciseAsFileTime | kernel32.dll | Récupère l'heure système de haute précision |

# ⚠️ Avertissements
- Cet outil est destiné à des fins éducatives et de recherche uniquement
- Certains jeux en ligne disposent de systèmes anti-triche — l'utilisation de cet outil peut entraîner le bannissement du compte
- Une vitesse excessive peut provoquer des dysfonctionnements du moteur physique ou des plantages
- Utilisation déconseillée dans les jeux en ligne compétitifs
- Les logiciels open-source sans signature numérique peuvent déclencher des faux positifs des antivirus

# 🔄 Retour d'information
Si vous rencontrez des problèmes, veuillez nous contacter via :
- [FAQ](https://github.com/game1024/OpenSpeedy/wiki#faq) — Consultez d'abord le wiki pour les problèmes courants
- [GitHub Issues](https://github.com/game1024/OpenSpeedy/issues) — Soumettez des rapports de bugs. Veuillez ne pas soumettre de problèmes liés au stockage cloud, merci de votre coopération~ 🙏


# 📜 Licence
OpenSpeedy est sous licence GPL v3.

# 🙏 Remerciements
OpenSpeedy utilise le code source des projets suivants. Merci à la communauté open-source ! Si OpenSpeedy vous aide, n'hésitez pas à nous donner une étoile !
- [minhook](https://github.com/TsudaKageyu/minhook) : Pour le hooking d'API
- [tauri](https://tauri.app/) : Interface graphique

Avertissement : OpenSpeedy est destiné uniquement à des fins éducatives et de recherche. Les utilisateurs assument tous les risques et responsabilités liés à l'utilisation de ce logiciel. L'auteur n'est pas responsable des pertes ou de la responsabilité juridique découlant de l'utilisation de ce logiciel.

<a href="https://openomy.com/game1024/openspeedy" target="_blank" style="display: block; width: 100%;" align="center">
  <img src="https://openomy.com/svg?repo=game1024/openspeedy&chart=bubble&latestMonth=6" target="_blank" alt="Contribution Leaderboard" style="display: block; width: 100%;" />
</a>


<p align="center">
  <img src="https://api.star-history.com/svg?repos=game1024/openspeedy&type=Date" Alt="Star History Chart">
</p>
