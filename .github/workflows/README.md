# GitHub Actions Workflow: Deploy to GitHub Pages

This GitHub Actions workflow automates the process of deploying new files from the main branch to the gh-pages branch, updating the contents of a `data` folder.

## Workflow Details

- **Trigger:** The workflow is triggered on each push to the main branch.
- **Job:** The workflow consists of a single job named `deploy`.
- **Runner:** The job runs on the latest version of Ubuntu.

When changes to the `gh-pages` branch are picked up, it will automatically start a new deploy a new update to github pages which can be accessed on:

```
https://api3dao.github.io/dapi-management/data/<merkle-tree-folder-path>/current-hash.json
```
