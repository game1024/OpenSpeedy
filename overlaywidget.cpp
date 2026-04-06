#include "overlaywidget.h"
#include <QVBoxLayout>
#include <QScreen>
#include <QGuiApplication>
#include <QPainter>
#include <QApplication>

OverlayWidget::OverlayWidget(QWidget *parent)
    : QWidget(nullptr)
{
    // 设置无边框、置顶、穿透
    setWindowFlags(Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Tool);
    setAttribute(Qt::WA_TranslucentBackground);
    setAttribute(Qt::WA_ShowWithoutActivating);
    
    QVBoxLayout *layout = new QVBoxLayout(this);
    m_label = new QLabel(this);
    m_label->setStyleSheet("color: #00BFFF; font: bold 24px 'Segoe UI'; background: rgba(20, 20, 20, 180); border-radius: 8px; padding: 10px 20px; border: 1px solid rgba(0, 191, 255, 100);");
    m_label->setAlignment(Qt::AlignCenter);
    layout->addWidget(m_label);
    
    m_hideTimer = new QTimer(this);
    m_hideTimer->setSingleShot(true);
    connect(m_hideTimer, &QTimer::timeout, this, &OverlayWidget::hide);

    // 默认放在右上角
    QScreen *screen = QGuiApplication::primaryScreen();
    if (screen) {
        QRect screenGeometry = screen->availableGeometry();
        move(screenGeometry.width() - 250, 50);
    }
}

OverlayWidget::~OverlayWidget()
{
}

void OverlayWidget::setSpeedText(const QString &text)
{
    m_label->setText(text);
    adjustSize();
}

void OverlayWidget::showTemporarily(int ms)
{
    show();
    m_hideTimer->start(ms);
}

void OverlayWidget::paintEvent(QPaintEvent *event)
{
    Q_UNUSED(event);
    // Translucent background allows the rounded QSS to show through
}
