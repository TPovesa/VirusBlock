# NeuralV Linux CLI

Лёгкий Linux-клиент: полноэкранный TUI, единый вход и серверная проверка без тяжёлого интерфейса.

## Установить `nv`

```sh
curl -fsSL https://neuralvv.org/install/nv.sh | sh
```

## Установить NeuralV

```sh
nv install neuralv@latest
```

## Запустить

```sh
neuralv
```

Быстрые команды:

```sh
neuralv --low-motion
neuralv --motion
neuralv doctor
neuralv -v
```

## Что внутри

- единый вход через `/basedata`
- мягкие анимации для SSH и слабых терминалов
- живая серверная проверка с отменой
- последний итог всегда под рукой

## Основные команды `nv`

```sh
nv install neuralv@latest
nv install neuralv@1.3.1
nv uninstall neuralv
nv -v
```

`nv` ставит `neuralv`, `neuralv-shell` и, когда он опубликован, `neuralvd` в `~/.local/bin`.
