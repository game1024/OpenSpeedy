#ifndef ABOUTDIALOG_H
#define ABOUTDIALOG_H
#include "config.h"
#include <QDialog>

namespace Ui
{
class AboutDialog;
}

class AboutDialog : public QDialog
{
    Q_OBJECT

  public:
    explicit AboutDialog(QWidget* parent = nullptr);
    ~AboutDialog();

  private slots:
    void recreate();

  private:
    Ui::AboutDialog* ui;
};

#endif // ABOUTDIALOG_H
