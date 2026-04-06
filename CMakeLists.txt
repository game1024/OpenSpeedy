cmake_minimum_required(VERSION 3.16)

project(OpenSpeedy VERSION 1.8.1 LANGUAGES CXX)


set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 启用Qt静态链接
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

find_package(QT NAMES Qt6 Qt5 REQUIRED COMPONENTS Widgets LinguistTools)
find_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Widgets Network WinExtras LinguistTools)
set(TS_FILES
  OpenSpeedy_zh_CN.ts
  OpenSpeedy_en_US.ts
  OpenSpeedy_zh_TW.ts
)

set(PROJECT_SOURCES
        main.cpp
        mainwindow.cpp
        mainwindow.h
        mainwindow.ui
        themeutils.h
        themeutils.cpp
        focusmonitor.h
        focusmonitor.cpp
        overlaywidget.h
        overlaywidget.cpp
        ${TS_FILES}
)

if(${QT_VERSION_MAJOR} GREATER_EQUAL 6)
    qt_add_executable(OpenSpeedy

        MANUAL_FINALIZATION
        ${PROJECT_SOURCES}
        winutils.h winutils.cpp
        processmonitor.h processmonitor.cpp
        resources.qrc
        images/icon.ico images/logo.png
        icons.rc
    )

# Define target properties for Android with Qt 6 as:
#    set_property(TARGET OpenSpeedy APPEND PROPERTY QT_ANDROID_PACKAGE_SOURCE_DIR

#                 ${CMAKE_CURRENT_SOURCE_DIR}/android)
# For more information, see https://doc.qt.io/qt-6/qt-add-executable.html#target-creation

    qt_create_translation(QM_FILES ${CMAKE_SOURCE_DIR} ${TS_FILES})
else()
      qt5_create_translation(QM_FILES
        ${CMAKE_SOURCE_DIR}
        ${TS_FILES})

      add_definitions("-DUNICODE -DNOMINMAX")
      add_executable(OpenSpeedy

          ${PROJECT_SOURCES}
          processmonitor.h processmonitor.cpp
          resources.qrc
          images/icon.ico images/logo.png
          icons.rc
          config.h
          windbg.h
          aboutdialog.ui
          aboutdialog.h aboutdialog.cpp aboutdialog.ui
          preferencedialog.h preferencedialog.cpp preferencedialog.ui
          qsinglekeysequenceedit.h qsinglekeysequenceedit.cpp
          ${QM_FILES}


      )

      add_library(winutils
        winutils.h winutils.cpp
        cpuutils.h cpuutils.cpp
        memutils.h memutils.cpp
        taskscheduler.h
        taskscheduler.cpp
      )

      target_include_directories(winutils PUBLIC
          ${CMAKE_CURRENT_SOURCE_DIR}
      )

    target_link_libraries(winutils PUBLIC
      Qt${QT_VERSION_MAJOR}::Core
      pdh
      ole32
      oleaut32
      taskschd)
endif()



target_link_libraries(OpenSpeedy PRIVATE

  Qt${QT_VERSION_MAJOR}::Widgets
  Qt${QT_VERSION_MAJOR}::Network
  Qt${QT_VERSION_MAJOR}::WinExtras
  winutils
)

# Qt for iOS sets MACOSX_BUNDLE_GUI_IDENTIFIER automatically since Qt 6.1.
# If you are developing for iOS or macOS you should consider setting an
# explicit, fixed bundle identifier manually though.
if(${QT_VERSION} VERSION_LESS 6.1.0)
  set(BUNDLE_ID_OPTION MACOSX_BUNDLE_GUI_IDENTIFIER com.example.OpenSpeedy)
endif()
set_target_properties(OpenSpeedy PROPERTIES

    ${BUNDLE_ID_OPTION}
    MACOSX_BUNDLE_BUNDLE_VERSION ${PROJECT_VERSION}
    MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION_MAJOR}.${PROJECT_VERSION_MINOR}
    MACOSX_BUNDLE TRUE
    WIN32_EXECUTABLE TRUE
    #LINK_FLAGS "/MANIFESTUAC:\"level='requireAdministrator' uiAccess='false'\" /SUBSYSTEM:WINDOWS"
)

include(GNUInstallDirs)
install(TARGETS OpenSpeedy

    BUNDLE DESTINATION .
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)

if(QT_VERSION_MAJOR EQUAL 6)
    qt_finalize_executable(OpenSpeedy)

endif()

add_subdirectory(third_party/minhook)
add_subdirectory(speedpatch)
add_subdirectory(bridge)

