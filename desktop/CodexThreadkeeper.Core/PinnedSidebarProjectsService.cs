using System.Text.Json;

namespace CodexThreadkeeper.Core;

public sealed class PinnedSidebarProjectsService
{
    private const int PinnedProjectsFileVersion = 1;

    public string PinnedProjectsPath(string codexHome)
    {
        return AppConstants.PinnedSidebarProjectsPath(codexHome);
    }

    public async Task<IReadOnlyList<string>> LoadPinnedProjectsAsync(string codexHome)
    {
        string filePath = PinnedProjectsPath(codexHome);
        if (!File.Exists(filePath))
        {
            return [];
        }

        JsonElement root;
        try
        {
            root = JsonSerializer.Deserialize<JsonElement>(await File.ReadAllTextAsync(filePath));
        }
        catch (JsonException error)
        {
            throw new InvalidOperationException($"Invalid {Path.GetFileName(filePath)}: {error.Message}");
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException($"Invalid {Path.GetFileName(filePath)}: expected a top-level JSON object.");
        }

        if (!root.TryGetProperty("version", out JsonElement versionElement) || versionElement.ValueKind != JsonValueKind.Number || versionElement.GetInt32() != PinnedProjectsFileVersion)
        {
            string version = root.TryGetProperty("version", out JsonElement versionValue) ? versionValue.ToString() : "(missing)";
            throw new InvalidOperationException(
                $"Invalid {Path.GetFileName(filePath)}: expected version {PinnedProjectsFileVersion}, received {version}.");
        }

        if (!root.TryGetProperty("projects", out JsonElement projectsElement) || projectsElement.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException($"Invalid {Path.GetFileName(filePath)}: expected \"projects\" to be an array.");
        }

        List<string> projects = [];
        HashSet<string> seenKeys = new(StringComparer.Ordinal);
        int index = 0;
        foreach (JsonElement projectElement in projectsElement.EnumerateArray())
        {
            if (projectElement.ValueKind != JsonValueKind.String)
            {
                throw new InvalidOperationException($"Invalid {Path.GetFileName(filePath)}: project at index {index} must be a non-empty string.");
            }

            string? normalized = GlobalStateService.NormalizeWorkspaceRootPath(projectElement.GetString());
            if (string.IsNullOrWhiteSpace(normalized) || !Path.IsPathRooted(normalized))
            {
                throw new InvalidOperationException($"Invalid {Path.GetFileName(filePath)}: project at index {index} must be an absolute path.");
            }

            string? key = GlobalStateService.WorkspaceRootKey(normalized);
            if (!string.IsNullOrWhiteSpace(key) && seenKeys.Add(key))
            {
                projects.Add(normalized);
            }

            index += 1;
        }

        return projects;
    }
}
