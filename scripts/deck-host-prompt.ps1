function Get-DeckHostPromptResult {
    [CmdletBinding()]
    param(
        [AllowEmptyString()]
        [string]$SuggestedHost = "",

        [Parameter(Mandatory)]
        [scriptblock]$ReadInput
    )

    if ([string]::IsNullOrWhiteSpace($SuggestedHost)) {
        $enteredHost = & $ReadInput "No known Steam Deck hostname resolved. Enter the Steam Deck hostname or IP address manually"
        return [string]$enteredHost
    }

    $enteredHost = & $ReadInput "Steam Deck hostname or IP [$SuggestedHost]"
    if ([string]::IsNullOrWhiteSpace($enteredHost)) {
        return $SuggestedHost
    }

    return [string]$enteredHost
}
