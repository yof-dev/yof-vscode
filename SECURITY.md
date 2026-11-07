# Security policy

## Reporting a problem

Please report security problems privately. Do not open a public issue.

- Email **security@yof.io**, or
- use GitHub's private vulnerability reporting on this repository (Security > Report a vulnerability).

Tell us what you found, how to reproduce it, and what an attacker could do with it. We reply within three working days.

## Scope

This repository is the yof extension for VS Code and editors that install from Open VSX. Examples of what we want to hear about:

- The extension showing or copying a secret in full anywhere (Problems, the output panel, the fix prompt).
- The extension sending anything over the network itself, or the CLI doing so while `yof.packageLookups` is off.
- A workspace you have not trusted making the extension run a program from that workspace.
- yof attack starting without the question in the editor, or against an address other than `yof.attack.target`.

Problems in the CLI itself go to the same address, or to github.com/yof-dev/yof.

## Supported versions

Security fixes go into the latest release.
