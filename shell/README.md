# NeuralV Linux shell

Linux shell/TUI flow for NeuralV now starts with `nv`.

## Bootstrap nv

```sh
curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh
```

## Install NeuralV

```sh
nv install neuralv@latest
```

## Common commands

```sh
nv install neuralv@latest
nv install neuralv@<version>
nv uninstall neuralv
nv -v
neuralv -v
```

`nv` installs the NeuralV shell client into `~/.local/bin`. After install, run `neuralv` to open the TUI client.
