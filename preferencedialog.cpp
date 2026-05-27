/*
 * OpenSpeedy - Open Source Game Speed Controller
 * Copyright (C) 2025 Game1024
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
#include "preferencedialog.h"
#include "ui_preferencedialog.h"
#include <QDebug>
#include <QPushButton>
#include <QScreen>
PreferenceDialog::PreferenceDialog(HWND hMainWindow,
                                   QSettings* settings,
                                   QLabel* increaseSpeedLabel,
                                   QLabel* decreaseSpeedLabel,
                                   QLabel* resetSpeedLabel,
                                   QWidget* parent)
  : QDialog(parent)
  , ui(new Ui::PreferenceDialog)
  , m_settings(settings)
  , m_increaseSpeedLabel(increaseSpeedLabel)
  , m_decreaseSpeedLabel(decreaseSpeedLabel)
  , m_resetSpeedLabel(resetSpeedLabel)
  , m_mainwindow(hMainWindow)
{
    ui->setupUi(this);
    setWindowFlags(Qt::Dialog | Qt::WindowTitleHint | Qt::CustomizeWindowHint);

    ui->buttonBox->button(QDialogButtonBox::Ok)->setText(tr("确认"));
    ui->buttonBox->button(QDialogButtonBox::Cancel)->setText(tr("取消"));

    loadShortcut(
      HOTKEY_INCREASE_SPEED, CONFIG_HOTKEY_SPEEDUP, DEFAULT_HOTKEY_SPEEDUP);
    loadShortcut(
      HOTKEY_DECREASE_SPEED, CONFIG_HOTKEY_SPEEDDOWN, DEFAULT_HOTKEY_SPEEDDOWN);
    loadShortcut(
      HOTKEY_RESET_SPEED, CONFIG_HOTKEY_RESETSPEED, DEFAULT_HOTKEY_RERSETSPEED);
    loadShortcut(HOTKEY_SHIFT1, CONFIG_HOTKEY_SHIFT1, DEFAULT_HOTKEY_SHIFT1);
    loadShortcut(HOTKEY_SHIFT2, CONFIG_HOTKEY_SHIFT2, DEFAULT_HOTKEY_SHIFT2);
    loadShortcut(HOTKEY_SHIFT3, CONFIG_HOTKEY_SHIFT3, DEFAULT_HOTKEY_SHIFT3);
    loadShortcut(HOTKEY_SHIFT4, CONFIG_HOTKEY_SHIFT4, DEFAULT_HOTKEY_SHIFT4);
    loadShortcut(HOTKEY_SHIFT5, CONFIG_HOTKEY_SHIFT5, DEFAULT_HOTKEY_SHIFT5);

    m_shift1Value =
      m_settings->value(CONFIG_SHIFT1_VALUE, DEFAULT_SHIFT1_VALUE).toDouble();
    m_shift2Value =
      m_settings->value(CONFIG_SHIFT2_VALUE, DEFAULT_SHIFT2_VALUE).toDouble();
    m_shift3Value =
      m_settings->value(CONFIG_SHIFT3_VALUE, DEFAULT_SHIFT3_VALUE).toDouble();
    m_shift4Value =
      m_settings->value(CONFIG_SHIFT4_VALUE, DEFAULT_SHIFT4_VALUE).toDouble();
    m_shift5Value =
      m_settings->value(CONFIG_SHIFT5_VALUE, DEFAULT_SHIFT5_VALUE).toDouble();

    m_increaseStep =
      m_settings->value(CONFIG_INCREASE_STEP, DEFAULT_INCREASE_STEP).toInt();
    m_decreaseStep =
      m_settings->value(CONFIG_DECREASE_STEP, DEFAULT_DECREASE_STEP).toInt();

    connect(QGuiApplication::primaryScreen(),
            &QScreen::logicalDotsPerInchChanged,
            this,
            &PreferenceDialog::recreate);
    redraw();
    adjustSize();
    setupGlobalHotkeys();
}

PreferenceDialog::~PreferenceDialog()
{
    unregisterGlobalHotkeys();
    delete ui;
}

int
PreferenceDialog::getIncreaseStep()
{
    return m_increaseStep;
}

int
PreferenceDialog::getDecreaseStep()
{
    return m_decreaseStep;
}

double
PreferenceDialog::getShift1()
{
    return m_shift1Value;
}

double
PreferenceDialog::getShift2()
{
    return m_shift2Value;
}

double
PreferenceDialog::getShift3()
{
    return m_shift3Value;
}

double
PreferenceDialog::getShift4()
{
    return m_shift4Value;
}

double
PreferenceDialog::getShift5()
{
    return m_shift5Value;
}

void
PreferenceDialog::show()
{
    unregisterGlobalHotkeys();
    QDialog::show();
}

void
PreferenceDialog::setupGlobalHotkeys()
{
    for (auto it = m_shortcuts.begin(); it != m_shortcuts.end(); it++)
    {
        int id = it.key();
        QtCombinedKey combined = it.value();

        if (combined.key == 0)
        {
            continue;
        }

        UINT vk = QSingleKeySequenceEdit::toVK(combined.key, combined.modifier);
        UINT modifier = QSingleKeySequenceEdit::toModifier(combined.modifier);
        RegisterHotKey(m_mainwindow, id, modifier, vk);
    }

    qDebug() << "全局快捷键已注册:";
}

void
PreferenceDialog::unregisterGlobalHotkeys()
{
    for (auto it = m_shortcuts.begin(); it != m_shortcuts.end(); it++)
    {
        int id = it.key();
        UnregisterHotKey(m_mainwindow, id);
    }
    qDebug() << "全局快捷键已注销";
}

void
PreferenceDialog::loadShortcut(int id,
                               const QString& config,
                               const QString& defaultValue)
{
    m_shortcuts.insert(id,
                       QSingleKeySequenceEdit::toQtCombinedKey(
                         m_settings->value(config, defaultValue).toString()));
}

void
PreferenceDialog::dump()
{
    dumpShortcut(CONFIG_HOTKEY_SPEEDUP,
                 ui->speedUpKeySequenceEdit->getKeyText());
    dumpShortcut(CONFIG_HOTKEY_SPEEDDOWN,
                 ui->speedDownKeySequenceEdit->getKeyText());
    dumpShortcut(CONFIG_HOTKEY_RESETSPEED,
                 ui->resetSpeedKeySequenceEdit->getKeyText());

    dumpShortcut(CONFIG_HOTKEY_SHIFT1, ui->shift1KeySequenceEdit->getKeyText());
    dumpShortcut(CONFIG_HOTKEY_SHIFT2, ui->shift2KeySequenceEdit->getKeyText());
    dumpShortcut(CONFIG_HOTKEY_SHIFT3, ui->shift3KeySequenceEdit->getKeyText());
    dumpShortcut(CONFIG_HOTKEY_SHIFT4, ui->shift4KeySequenceEdit->getKeyText());
    dumpShortcut(CONFIG_HOTKEY_SHIFT5, ui->shift5KeySequenceEdit->getKeyText());
    m_settings->setValue(CONFIG_INCREASE_STEP,
                         ui->increaseStepSpinBox->value());
    m_settings->setValue(CONFIG_DECREASE_STEP,
                         ui->decreaseStepSpinBox->value());
    m_settings->setValue(CONFIG_SHIFT1_VALUE, ui->shift1DoubleSpinBox->value());
    m_settings->setValue(CONFIG_SHIFT2_VALUE, ui->shift2DoubleSpinBox->value());
    m_settings->setValue(CONFIG_SHIFT3_VALUE, ui->shift3DoubleSpinBox->value());
    m_settings->setValue(CONFIG_SHIFT4_VALUE, ui->shift4DoubleSpinBox->value());
    m_settings->setValue(CONFIG_SHIFT5_VALUE, ui->shift5DoubleSpinBox->value());
    m_settings->sync();
}

void
PreferenceDialog::dumpShortcut(const QString& config, const QString& keyText)
{
    m_settings->setValue(config, keyText);
}

void
PreferenceDialog::updateShortcut(int id, QSingleKeySequenceEdit* keyEdit)
{
    m_shortcuts[id] = keyEdit->getQtCombinedKey();
}

void
PreferenceDialog::update()
{
    updateShortcut(HOTKEY_INCREASE_SPEED, ui->speedUpKeySequenceEdit);
    updateShortcut(HOTKEY_DECREASE_SPEED, ui->speedDownKeySequenceEdit);
    updateShortcut(HOTKEY_RESET_SPEED, ui->resetSpeedKeySequenceEdit);
    updateShortcut(HOTKEY_SHIFT1, ui->shift1KeySequenceEdit);
    updateShortcut(HOTKEY_SHIFT2, ui->shift2KeySequenceEdit);
    updateShortcut(HOTKEY_SHIFT3, ui->shift3KeySequenceEdit);
    updateShortcut(HOTKEY_SHIFT4, ui->shift4KeySequenceEdit);
    updateShortcut(HOTKEY_SHIFT5, ui->shift5KeySequenceEdit);

    m_increaseStep = ui->increaseStepSpinBox->value();
    m_decreaseStep = ui->decreaseStepSpinBox->value();
    m_shift1Value = ui->shift1DoubleSpinBox->value();
    m_shift2Value = ui->shift2DoubleSpinBox->value();
    m_shift3Value = ui->shift3DoubleSpinBox->value();
    m_shift4Value = ui->shift4DoubleSpinBox->value();
    m_shift5Value = ui->shift5DoubleSpinBox->value();
}

void
PreferenceDialog::redrawSpinBox(QSpinBox* spinbox, int value)
{
    spinbox->setValue(value);
}

void
PreferenceDialog::redrawSpinBox(QDoubleSpinBox* spinbox, double value)
{
    spinbox->setValue(value);
}

void
PreferenceDialog::redrawKeyEdit(QSingleKeySequenceEdit* keyEdit, int id)
{
    QtCombinedKey combinedKey = m_shortcuts[id];
    keyEdit->setKeySequence(combinedKey.key | combinedKey.modifier);
}

void
PreferenceDialog::redraw()
{
    redrawKeyEdit(ui->speedUpKeySequenceEdit, HOTKEY_INCREASE_SPEED);
    redrawKeyEdit(ui->speedDownKeySequenceEdit, HOTKEY_DECREASE_SPEED);
    redrawKeyEdit(ui->resetSpeedKeySequenceEdit, HOTKEY_RESET_SPEED);
    redrawKeyEdit(ui->shift1KeySequenceEdit, HOTKEY_SHIFT1);
    redrawKeyEdit(ui->shift2KeySequenceEdit, HOTKEY_SHIFT2);
    redrawKeyEdit(ui->shift3KeySequenceEdit, HOTKEY_SHIFT3);
    redrawKeyEdit(ui->shift4KeySequenceEdit, HOTKEY_SHIFT4);
    redrawKeyEdit(ui->shift5KeySequenceEdit, HOTKEY_SHIFT5);

    redrawSpinBox(ui->increaseStepSpinBox, m_increaseStep);
    redrawSpinBox(ui->decreaseStepSpinBox, m_decreaseStep);
    redrawSpinBox(ui->shift1DoubleSpinBox, m_shift1Value);
    redrawSpinBox(ui->shift2DoubleSpinBox, m_shift2Value);
    redrawSpinBox(ui->shift3DoubleSpinBox, m_shift3Value);
    redrawSpinBox(ui->shift4DoubleSpinBox, m_shift4Value);
    redrawSpinBox(ui->shift5DoubleSpinBox, m_shift5Value);

    m_increaseSpeedLabel->setText(
      QString(tr("%1 增加速度"))
        .arg(QSingleKeySequenceEdit::wrapText(
          ui->speedUpKeySequenceEdit->getKeyText())));

    m_decreaseSpeedLabel->setText(
      QString(tr("%1 减少速度"))
        .arg(QSingleKeySequenceEdit::wrapText(
          ui->speedDownKeySequenceEdit->getKeyText())));

    m_resetSpeedLabel->setText(
      QString(tr("%1 重置速度"))
        .arg(QSingleKeySequenceEdit::wrapText(
          ui->resetSpeedKeySequenceEdit->getKeyText())));

    adjustSize();
}

void
PreferenceDialog::on_buttonBox_accepted()
{
    update();
    setupGlobalHotkeys();
    redraw();
    dump();
}

void
PreferenceDialog::on_buttonBox_rejected()
{
    redraw();
    setupGlobalHotkeys();
}

void
PreferenceDialog::recreate()
{
    layout()->invalidate();
    layout()->activate();
    adjustSize();
}
