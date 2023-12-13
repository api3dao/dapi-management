# github-pages.yml

This GitHub Actions workflow detects changes to the data folder on the main branch, and pushes those changes to the gh-pages branch.

## Details

- **Trigger:** The workflow is triggered on each push to the main branch.
- **Job:** The workflow consists of a single job named `deploy`.
- **Runner:** The job runs on the latest version of Ubuntu.

Due to the size of `dapi-pricing` merkle tree values we need to split the values into separate files.
The workflow will:

1. Checkout the required files including the script that needs to split the values
2. Install packages in order for the split script to run
3. Run the script that splits the values into separate files
4. Commit and push if there are changes to the data directory

When changes to the `gh-pages` branch are picked up, it will automatically trigger a new deploy of gh-pages branch which can be accessed on:

```
https://api3dao.github.io/dapi-management/data/<merkle-tree-folder-path>/current-hash.json
```
